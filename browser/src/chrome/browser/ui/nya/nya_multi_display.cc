// Copyright 2026 Nya Browser
// Use of this source code is governed by a BSD-style license.

#include "chrome/browser/ui/nya/nya_multi_display.h"

#include <errno.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/command_line.h"
#include "base/files/file_descriptor_watcher_posix.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/strings/string_number_conversions.h"
#include "base/values.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_init_state.h"
#include "chrome/browser/ui/browser_tabstrip.h"
#include "chrome/browser/ui/browser_window.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/browser_window/public/create_browser_window.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/common/chrome_paths.h"
#include "components/ungoogled/ungoogled_switches.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/base_window.h"
#include "ui/events/platform/x11/x11_event_source.h"
#include "ui/gfx/x/connection.h"
#include "url/gurl.h"

namespace nya {
namespace {

constexpr size_t kMaxLine = 16 * 1024;

std::string JsonError(int id, const std::string& message) {
  base::DictValue d;
  d.Set("id", id);
  d.Set("ok", false);
  d.Set("error", message);
  std::string out;
  base::JSONWriter::Write(d, &out);
  out.push_back('\n');
  return out;
}

std::string JsonOk(int id, base::DictValue extra) {
  extra.Set("id", id);
  extra.Set("ok", true);
  std::string out;
  base::JSONWriter::Write(extra, &out);
  out.push_back('\n');
  return out;
}

class Client;

class Controller {
 public:
  static Controller* Get() {
    static base::NoDestructor<Controller> instance;
    return instance.get();
  }

  ~Controller();

  void Start() {
    if (listen_fd_ >= 0)
      return;
    if (!base::CommandLine::ForCurrentProcess()->HasSwitch(
            switches::kNyaX11MultiDisplay)) {
      return;
    }

    base::FilePath dir;
    if (!base::PathService::Get(chrome::DIR_USER_DATA, &dir)) {
      LOG(ERROR) << "nya-chrome.sock: no user-data-dir";
      return;
    }
    sock_path_ = dir.AppendASCII("nya-chrome.sock");
    base::DeleteFile(sock_path_);

    listen_fd_ = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (listen_fd_ < 0) {
      PLOG(ERROR) << "nya-chrome.sock: socket";
      return;
    }

    sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    const std::string path = sock_path_.value();
    if (path.size() >= sizeof(addr.sun_path)) {
      LOG(ERROR) << "nya-chrome.sock path too long";
      close(listen_fd_);
      listen_fd_ = -1;
      return;
    }
    memcpy(addr.sun_path, path.c_str(), path.size() + 1);
    if (bind(listen_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) <
        0) {
      PLOG(ERROR) << "nya-chrome.sock: bind";
      close(listen_fd_);
      listen_fd_ = -1;
      return;
    }
    chmod(path.c_str(), 0600);
    if (listen(listen_fd_, 8) < 0) {
      PLOG(ERROR) << "nya-chrome.sock: listen";
      close(listen_fd_);
      listen_fd_ = -1;
      return;
    }

    accept_watch_ = base::FileDescriptorWatcher::WatchReadable(
        listen_fd_, base::BindRepeating(&Controller::OnAccept,
                                        base::Unretained(this)));
    LOG(INFO) << "nya-chrome.sock listening at " << path;
  }

  void Stop();

  void RemoveClient(Client* client);

  std::string Handle(const base::DictValue& req);

 private:
  void OnAccept();

  base::FilePath sock_path_;
  int listen_fd_ = -1;
  std::unique_ptr<base::FileDescriptorWatcher::Controller> accept_watch_;
  std::vector<std::unique_ptr<Client>> clients_;
};

class Client {
 public:
  Client(Controller* controller, int fd)
      : controller_(controller), fd_(fd) {
    read_watch_ = base::FileDescriptorWatcher::WatchReadable(
        fd_, base::BindRepeating(&Client::OnReadable, base::Unretained(this)));
  }

  Client(const Client&) = delete;
  Client& operator=(const Client&) = delete;

  ~Client() {
    read_watch_.reset();
    if (fd_ >= 0) {
      close(fd_);
      fd_ = -1;
    }
  }

 private:
  void OnReadable() {
    char buf[4096];
    for (;;) {
      ssize_t n = read(fd_, buf, sizeof(buf));
      if (n < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK)
          return;
        controller_->RemoveClient(this);
        return;
      }
      if (n == 0) {
        controller_->RemoveClient(this);
        return;
      }
      pending_.append(buf, static_cast<size_t>(n));
      if (pending_.size() > kMaxLine) {
        controller_->RemoveClient(this);
        return;
      }
      size_t nl;
      while ((nl = pending_.find('\n')) != std::string::npos) {
        std::string line = pending_.substr(0, nl);
        pending_.erase(0, nl + 1);
        HandleLine(line);
      }
    }
  }

  void HandleLine(const std::string& line) {
    if (line.empty())
      return;
    auto parsed = base::JSONReader::Read(line, base::JSON_PARSE_RFC);
    int id = 0;
    if (!parsed || !parsed->is_dict()) {
      Write(JsonError(id, "invalid json"));
      return;
    }
    const auto& dict = parsed->GetDict();
    id = dict.FindInt("id").value_or(0);
    Write(controller_->Handle(dict));
  }

  void Write(const std::string& data) {
    const char* p = data.data();
    size_t left = data.size();
    while (left) {
      ssize_t n = write(fd_, p, left);
      if (n < 0) {
        // Nonblocking sockets can EAGAIN; a truncated JSON line is worse than
        // dropping the client and letting it reconnect.
        controller_->RemoveClient(this);
        return;
      }
      p += n;
      left -= static_cast<size_t>(n);
    }
  }

  raw_ptr<Controller> controller_;
  int fd_ = -1;
  std::string pending_;
  std::unique_ptr<base::FileDescriptorWatcher::Controller> read_watch_;
};

Controller::~Controller() {
  Stop();
}

void Controller::Stop() {
  clients_.clear();
  accept_watch_.reset();
  if (listen_fd_ >= 0) {
    close(listen_fd_);
    listen_fd_ = -1;
  }
  if (!sock_path_.empty()) {
    base::DeleteFile(sock_path_);
  }
}

void Controller::OnAccept() {
  for (;;) {
    int fd = accept4(listen_fd_, nullptr, nullptr, SOCK_NONBLOCK | SOCK_CLOEXEC);
    if (fd < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK)
        return;
      PLOG(ERROR) << "nya-chrome.sock: accept";
      return;
    }
    clients_.push_back(std::make_unique<Client>(this, fd));
  }
}

void Controller::RemoveClient(Client* client) {
  std::erase_if(clients_, [client](const std::unique_ptr<Client>& c) {
    return c.get() == client;
  });
}

std::string Controller::Handle(const base::DictValue& req) {
  const int id = req.FindInt("id").value_or(0);
  const std::string* cmd = req.FindString("cmd");
  if (!cmd)
    return JsonError(id, "missing cmd");

  if (*cmd == "attachDisplay") {
    const std::string* display = req.FindString("display");
    if (!display || display->empty())
      return JsonError(id, "missing display");
    auto* conn = x11::Connection::GetOrCreate(*display);
    if (!conn)
      return JsonError(id, "failed to open display");
    if (ui::X11EventSource::HasInstance())
      ui::X11EventSource::GetInstance()->WatchConnection(conn);
    base::DictValue extra;
    extra.Set("display", conn->DisplayString());
    return JsonOk(id, std::move(extra));
  }

  if (*cmd == "createWindow") {
    const std::string* display = req.FindString("display");
    if (!display || display->empty())
      return JsonError(id, "missing display");
    auto* conn = x11::Connection::GetOrCreate(*display);
    if (!conn)
      return JsonError(id, "failed to open display");
    if (ui::X11EventSource::HasInstance())
      ui::X11EventSource::GetInstance()->WatchConnection(conn);

    Profile* profile =
        g_browser_process->profile_manager()->GetLastUsedProfile();
    if (!profile)
      return JsonError(id, "no profile");

    BrowserWindowCreateParams params(*profile, true);
    params.nya_x11_display = *display;
    params.omit_from_session_restore = true;
    params.should_trigger_session_restore = false;
    BrowserWindowInterface* browser = CreateBrowserWindow(std::move(params));
    if (!browser || !browser->GetWindow())
      return JsonError(id, "CreateBrowserWindow failed");

    std::string url = "about:blank";
    if (const std::string* u = req.FindString("url"); u && !u->empty())
      url = *u;
    content::WebContents* contents =
        chrome::AddAndReturnTabAt(browser, GURL(url), -1, true);
    browser->GetWindow()->Show();

    std::string target_id;
    if (contents) {
      auto host = content::DevToolsAgentHost::GetOrCreateFor(contents);
      if (host)
        target_id = host->GetId();
    }
    base::DictValue extra;
    extra.Set("display", *display);
    extra.Set("windowId", browser->GetSessionID().id());
    extra.Set("targetId", target_id);
    return JsonOk(id, std::move(extra));
  }

  if (*cmd == "listWindows") {
    base::ListValue windows;
    for (BrowserWindowInterface* bwi : GetAllBrowserWindowInterfaces()) {
      base::DictValue w;
      w.Set("windowId", bwi->GetSessionID().id());
      w.Set("display",
            BrowserInitState::From(bwi)->create_params().nya_x11_display);
      windows.Append(std::move(w));
    }
    base::DictValue extra;
    extra.Set("windows", std::move(windows));
    return JsonOk(id, std::move(extra));
  }

  if (*cmd == "moveTab") {
    const std::optional<int> from = req.FindInt("fromWindowId");
    const std::optional<int> to = req.FindInt("toWindowId");
    if (!from || !to)
      return JsonError(id, "missing window id");
    const int tab = req.FindInt("tabIndex").value_or(0);
    BrowserWindowInterface* src = nullptr;
    BrowserWindowInterface* dst = nullptr;
    for (BrowserWindowInterface* bwi : GetAllBrowserWindowInterfaces()) {
      if (bwi->GetSessionID().id() == *from)
        src = bwi;
      if (bwi->GetSessionID().id() == *to)
        dst = bwi;
    }
    if (!src || !dst)
      return JsonError(id, "window not found");
    if (!src->tab_strip_model() || tab < 0 ||
        tab >= src->tab_strip_model()->count()) {
      return JsonError(id, "tab index out of range");
    }
    chrome::MoveTabsToExistingWindow(src, dst, {tab});
    return JsonOk(id, base::DictValue());
  }

  if (*cmd == "ping") {
    return JsonOk(id, base::DictValue());
  }

  return JsonError(id, "unknown cmd");
}

}  // namespace

void StartMultiDisplayController() {
  Controller::Get()->Start();
}

void StopMultiDisplayController() {
  Controller::Get()->Stop();
}

}  // namespace nya
