import { useMemo, useState } from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export type SearchSelectOption = {
  value: string;
  label: string;
  group?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
};

export default function SearchSelect({
  value,
  onChange,
  options,
  placeholder = '选择',
  searchPlaceholder = '搜索',
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const current = options.find((opt) => opt.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.value.toLowerCase().includes(q) ||
        (opt.group || '').toLowerCase().includes(q),
    );
  }, [options, query]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, SearchSelectOption[]>();
    for (const opt of filtered) {
      const key = opt.group || '';
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(opt);
    }
    return order.map((key) => ({ key, items: map.get(key)! }));
  }, [filtered]);

  return (
    <Popover
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="h-8 w-full justify-between px-2.5 font-normal"
        >
          <span className={cn('min-w-0 truncate', !current && 'text-muted-foreground')}>
            {current?.label || placeholder}
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
        <Input
          value={query}
          placeholder={searchPlaceholder}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered[0]) {
              onChange(filtered[0].value);
              setOpen(false);
              setQuery('');
            }
          }}
        />
        <ScrollArea className="mt-2 h-56">
          {filtered.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">没有匹配项</div>
          ) : (
            groups.map((group) => (
              <div key={group.key || 'all'} className="mb-1">
                {group.key ? (
                  <div className="px-1.5 py-1 text-[11px] text-muted-foreground">{group.key}</div>
                ) : null}
                {group.items.map((opt) => {
                  const selected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm',
                        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                      )}
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                        setQuery('');
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                      {selected ? <CheckIcon className="size-4 shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
