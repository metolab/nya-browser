#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Chrome dlopens GTK and calls it through function pointers. Interposing
 * gtk_widget_show via PLT does nothing. Interpose dlsym so the pointers
 * Chrome stores are our wrappers.
 *
 * Do not change the process-wide default GdkDisplay: that leaks into later
 * GTK work. Only answer get_default / get_default_screen from the desk that
 * last sent a VNC button/key down, and move file-chooser windows at show.
 */

typedef unsigned long GType;
typedef int (*IsAFn)(void *, GType);
typedef GType (*GetTypeFn)(void);
typedef void *(*VoidFn)(void);
typedef void *(*DisplayOpenFn)(const char *);
typedef void *(*GetScreenFn)(void *);
typedef void *(*ScreenDisplayFn)(void *);
typedef const char *(*DisplayNameFn)(void *);
typedef void (*SetScreenFn)(void *, void *);
typedef void (*ShowFn)(void *);
typedef void (*PresentFn)(void *);
typedef void (*PresentTimeFn)(void *, unsigned);
typedef int (*RunFn)(void *);
typedef void *(*DlsymFn)(void *, const char *);

static DlsymFn real_dlsym;
static VoidFn real_get_default;
static VoidFn real_screen_default;
static ShowFn real_widget_show;
static ShowFn real_widget_show_all;
static PresentFn real_window_present;
static PresentTimeFn real_window_present_time;
static RunFn real_dialog_run;
static ShowFn real_native_show;
static DisplayOpenFn real_display_open;
static GetScreenFn real_default_screen;
static GetScreenFn real_window_screen;
static ScreenDisplayFn real_screen_display;
static DisplayNameFn real_display_name;
static SetScreenFn real_set_screen;
static IsAFn real_is_a;
static GetTypeFn real_file_chooser_type;
static GetTypeFn real_window_type;

static void *libc_dlsym(void *handle, const char *name) {
  if (!real_dlsym) {
    real_dlsym = (DlsymFn)dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.2.5");
    if (!real_dlsym) real_dlsym = (DlsymFn)dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.34");
  }
  return real_dlsym ? real_dlsym(handle, name) : NULL;
}

static int read_active_display(char *out, size_t cap) {
  const char *path = getenv("NYA_ACTIVE_DISPLAY_FILE");
  if (!path || !path[0]) return 0;
  FILE *fp = fopen(path, "r");
  if (!fp) return 0;
  if (!fgets(out, (int)cap, fp)) {
    fclose(fp);
    return 0;
  }
  fclose(fp);
  size_t n = strlen(out);
  while (n && (out[n - 1] == '\n' || out[n - 1] == '\r' || out[n - 1] == ' ')) {
    out[--n] = 0;
  }
  return n && out[0] == ':';
}

static int same_display(const char *a, const char *b) {
  if (!a || !b) return 0;
  size_t i = 0;
  while (a[i] && b[i] && a[i] != '.' && b[i] != '.') {
    if (a[i] != b[i]) return 0;
    i += 1;
  }
  return (a[i] == 0 || a[i] == '.') && (b[i] == 0 || b[i] == '.');
}

static void ensure_gdk(void) {
  if (!real_display_open) real_display_open = (DisplayOpenFn)libc_dlsym(RTLD_DEFAULT, "gdk_display_open");
  if (!real_default_screen)
    real_default_screen = (GetScreenFn)libc_dlsym(RTLD_DEFAULT, "gdk_display_get_default_screen");
  if (!real_set_screen) real_set_screen = (SetScreenFn)libc_dlsym(RTLD_DEFAULT, "gtk_window_set_screen");
  if (!real_window_screen) real_window_screen = (GetScreenFn)libc_dlsym(RTLD_DEFAULT, "gtk_window_get_screen");
  if (!real_screen_display)
    real_screen_display = (ScreenDisplayFn)libc_dlsym(RTLD_DEFAULT, "gdk_screen_get_display");
  if (!real_display_name) real_display_name = (DisplayNameFn)libc_dlsym(RTLD_DEFAULT, "gdk_display_get_name");
  if (!real_is_a) real_is_a = (IsAFn)libc_dlsym(RTLD_DEFAULT, "g_type_check_instance_is_a");
  if (!real_file_chooser_type)
    real_file_chooser_type = (GetTypeFn)libc_dlsym(RTLD_DEFAULT, "gtk_file_chooser_get_type");
  if (!real_window_type) real_window_type = (GetTypeFn)libc_dlsym(RTLD_DEFAULT, "gtk_window_get_type");
}

#define DPY_CACHE_MAX 16
static struct {
  char name[32];
  void *dpy;
} dpy_cache[DPY_CACHE_MAX];
static int dpy_cache_n;

static void *cached_open(const char *want) {
  for (int i = 0; i < dpy_cache_n; i += 1) {
    if (same_display(dpy_cache[i].name, want)) return dpy_cache[i].dpy;
  }
  if (!real_display_open) return NULL;
  void *dpy = real_display_open(want);
  if (!dpy || dpy_cache_n >= DPY_CACHE_MAX) return dpy;
  snprintf(dpy_cache[dpy_cache_n].name, sizeof(dpy_cache[0].name), "%s", want);
  dpy_cache[dpy_cache_n].dpy = dpy;
  dpy_cache_n += 1;
  return dpy;
}

static void *wanted_display(void) {
  char want[64];
  if (!read_active_display(want, sizeof(want))) return NULL;
  ensure_gdk();
  return cached_open(want);
}

static void *nya_gdk_display_get_default(void) {
  void *dpy = wanted_display();
  if (dpy) return dpy;
  return real_get_default ? real_get_default() : NULL;
}

static void *nya_gdk_screen_get_default(void) {
  void *dpy = nya_gdk_display_get_default();
  if (dpy && real_default_screen) return real_default_screen(dpy);
  return real_screen_default ? real_screen_default() : NULL;
}

static int is_type(void *obj, GetTypeFn type_fn) {
  if (!obj || !real_is_a || !type_fn) return 0;
  return real_is_a(obj, type_fn());
}

static void bind_file_chooser(void *widget) {
  ensure_gdk();
  if (!is_type(widget, real_file_chooser_type) || !is_type(widget, real_window_type)) return;
  char want[64];
  if (!read_active_display(want, sizeof(want))) return;
  if (real_window_screen && real_screen_display && real_display_name) {
    void *cur_screen = real_window_screen(widget);
    if (cur_screen) {
      void *cur_dpy = real_screen_display(cur_screen);
      const char *cur = cur_dpy ? real_display_name(cur_dpy) : NULL;
      if (same_display(cur, want)) return;
    }
  }
  void *dpy = wanted_display();
  if (!dpy || !real_default_screen || !real_set_screen) return;
  void *screen = real_default_screen(dpy);
  if (screen) real_set_screen(widget, screen);
}

static void nya_gtk_widget_show(void *widget) {
  bind_file_chooser(widget);
  if (real_widget_show) real_widget_show(widget);
}

static void nya_gtk_widget_show_all(void *widget) {
  bind_file_chooser(widget);
  if (real_widget_show_all) real_widget_show_all(widget);
}

static void nya_gtk_window_present(void *window) {
  bind_file_chooser(window);
  if (real_window_present) real_window_present(window);
}

static void nya_gtk_window_present_with_time(void *window, unsigned time) {
  bind_file_chooser(window);
  if (real_window_present_time) real_window_present_time(window, time);
}

static int nya_gtk_dialog_run(void *dialog) {
  bind_file_chooser(dialog);
  return real_dialog_run ? real_dialog_run(dialog) : -1;
}

static void nya_gtk_native_dialog_show(void *dialog) {
  /* Native choosers have no GtkWindow; get_default already redirects create. */
  if (real_native_show) real_native_show(dialog);
}

static void remember(const char *name, void *sym) {
  if (!name || !sym) return;
  if (!real_get_default && strcmp(name, "gdk_display_get_default") == 0) real_get_default = (VoidFn)sym;
  else if (!real_screen_default && strcmp(name, "gdk_screen_get_default") == 0)
    real_screen_default = (VoidFn)sym;
  else if (!real_widget_show && strcmp(name, "gtk_widget_show") == 0) real_widget_show = (ShowFn)sym;
  else if (!real_widget_show_all && strcmp(name, "gtk_widget_show_all") == 0)
    real_widget_show_all = (ShowFn)sym;
  else if (!real_window_present && strcmp(name, "gtk_window_present") == 0)
    real_window_present = (PresentFn)sym;
  else if (!real_window_present_time && strcmp(name, "gtk_window_present_with_time") == 0)
    real_window_present_time = (PresentTimeFn)sym;
  else if (!real_dialog_run && strcmp(name, "gtk_dialog_run") == 0) real_dialog_run = (RunFn)sym;
  else if (!real_native_show && strcmp(name, "gtk_native_dialog_show") == 0)
    real_native_show = (ShowFn)sym;
  else if (!real_display_open && strcmp(name, "gdk_display_open") == 0)
    real_display_open = (DisplayOpenFn)sym;
  else if (!real_default_screen && strcmp(name, "gdk_display_get_default_screen") == 0)
    real_default_screen = (GetScreenFn)sym;
  else if (!real_window_screen && strcmp(name, "gtk_window_get_screen") == 0)
    real_window_screen = (GetScreenFn)sym;
  else if (!real_screen_display && strcmp(name, "gdk_screen_get_display") == 0)
    real_screen_display = (ScreenDisplayFn)sym;
  else if (!real_display_name && strcmp(name, "gdk_display_get_name") == 0)
    real_display_name = (DisplayNameFn)sym;
  else if (!real_set_screen && strcmp(name, "gtk_window_set_screen") == 0)
    real_set_screen = (SetScreenFn)sym;
  else if (!real_is_a && strcmp(name, "g_type_check_instance_is_a") == 0) real_is_a = (IsAFn)sym;
  else if (!real_file_chooser_type && strcmp(name, "gtk_file_chooser_get_type") == 0)
    real_file_chooser_type = (GetTypeFn)sym;
  else if (!real_window_type && strcmp(name, "gtk_window_get_type") == 0)
    real_window_type = (GetTypeFn)sym;
}

static void *wrap(const char *name, void *sym) {
  if (!name || !sym) return sym;
  remember(name, sym);
  if (strcmp(name, "gdk_display_get_default") == 0) return (void *)nya_gdk_display_get_default;
  if (strcmp(name, "gdk_screen_get_default") == 0) return (void *)nya_gdk_screen_get_default;
  if (strcmp(name, "gtk_widget_show") == 0) return (void *)nya_gtk_widget_show;
  if (strcmp(name, "gtk_widget_show_all") == 0) return (void *)nya_gtk_widget_show_all;
  if (strcmp(name, "gtk_window_present") == 0) return (void *)nya_gtk_window_present;
  if (strcmp(name, "gtk_window_present_with_time") == 0) return (void *)nya_gtk_window_present_with_time;
  if (strcmp(name, "gtk_dialog_run") == 0) return (void *)nya_gtk_dialog_run;
  if (strcmp(name, "gtk_native_dialog_show") == 0) return (void *)nya_gtk_native_dialog_show;
  return sym;
}

void *dlsym(void *handle, const char *name) {
  return wrap(name, libc_dlsym(handle, name));
}

void gtk_widget_show(void *widget) { nya_gtk_widget_show(widget); }
void gtk_widget_show_all(void *widget) { nya_gtk_widget_show_all(widget); }
void gtk_window_present(void *window) { nya_gtk_window_present(window); }
void gtk_window_present_with_time(void *window, unsigned time) {
  nya_gtk_window_present_with_time(window, time);
}
int gtk_dialog_run(void *dialog) { return nya_gtk_dialog_run(dialog); }
void *gdk_display_get_default(void) { return nya_gdk_display_get_default(); }
void *gdk_screen_get_default(void) { return nya_gdk_screen_get_default(); }
