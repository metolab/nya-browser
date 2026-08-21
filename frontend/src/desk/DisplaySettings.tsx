import {
  DisplayPolicy,
  FB_LIMITS,
  SCALE_LIMITS,
  SIZE_PRESETS,
  formatScale,
  formatSize,
  normalizeDisplayPolicy,
  resolveRemoteSize,
} from './display';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  policy: DisplayPolicy;
  pane: { w: number; h: number };
  onChange: (next: DisplayPolicy) => void;
};

export default function DisplaySettings({ policy, pane, onChange }: Props) {
  const p = normalizeDisplayPolicy(policy);
  const patch = (partial: Partial<DisplayPolicy>) => {
    onChange(normalizeDisplayPolicy({ ...p, ...partial }));
  };
  const remote = resolveRemoteSize(pane, p);
  const preset =
    SIZE_PRESETS.find((x) => x.w === p.width && x.h === p.height)?.label || '自定义';

  return (
    <div
      className="grid gap-3"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">分辨率</span>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={p.mode}
          onValueChange={(value: string) => {
            if (!value) return;
            patch({ mode: value as DisplayPolicy['mode'] });
          }}
        >
          <ToggleGroupItem value="follow">跟随窗口</ToggleGroupItem>
          <ToggleGroupItem value="fixed">固定</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {p.mode === 'follow' && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">显示比例</span>
            <span className="text-xs">{formatScale(p.scale)}</span>
          </div>
          <Slider
            min={SCALE_LIMITS.min}
            max={SCALE_LIMITS.max}
            step={SCALE_LIMITS.step}
            value={[p.scale]}
            onValueChange={(value: number[]) => patch({ scale: Number(value[0]) })}
          />
        </div>
      )}

      {p.mode === 'fixed' ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">预设</span>
            <Select
              value={preset}
              onValueChange={(value: string) => {
                if (value === '当前窗口') {
                  patch({ width: pane.w, height: pane.h });
                  return;
                }
                const hit = SIZE_PRESETS.find((x) => x.label === value);
                if (hit) patch({ width: hit.w, height: hit.h });
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZE_PRESETS.map((x) => (
                  <SelectItem key={x.label} value={x.label}>
                    {x.label}
                  </SelectItem>
                ))}
                <SelectItem value="当前窗口">当前窗口 {formatSize(pane)}</SelectItem>
                <SelectItem value="自定义">自定义</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">宽</Label>
              <Input
                type="number"
                min={FB_LIMITS.minW}
                max={FB_LIMITS.maxW}
                step={2}
                value={p.width}
                onChange={(e) => patch({ width: Number(e.target.value || p.width) })}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">高</Label>
              <Input
                type="number"
                min={FB_LIMITS.minH}
                max={FB_LIMITS.maxH}
                step={2}
                value={p.height}
                onChange={(e) => patch({ height: Number(e.target.value || p.height) })}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">最小宽</Label>
              <Input
                type="number"
                min={FB_LIMITS.minW}
                max={p.maxWidth}
                step={2}
                value={p.minWidth}
                onChange={(e) => patch({ minWidth: Number(e.target.value || p.minWidth) })}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">最大宽</Label>
              <Input
                type="number"
                min={p.minWidth}
                max={FB_LIMITS.maxW}
                step={2}
                value={p.maxWidth}
                onChange={(e) => patch({ maxWidth: Number(e.target.value || p.maxWidth) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">最小高</Label>
              <Input
                type="number"
                min={FB_LIMITS.minH}
                max={p.maxHeight}
                step={2}
                value={p.minHeight}
                onChange={(e) => patch({ minHeight: Number(e.target.value || p.minHeight) })}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">最大高</Label>
              <Input
                type="number"
                min={p.minHeight}
                max={FB_LIMITS.maxH}
                step={2}
                value={p.maxHeight}
                onChange={(e) => patch({ maxHeight: Number(e.target.value || p.maxHeight) })}
              />
            </div>
          </div>
        </>
      )}

      <div className="border-t pt-2 text-xs text-muted-foreground">
        实际桌面 {formatSize(remote)}
        {p.mode === 'follow' ? ' · 跟随' : ' · 固定'}
        {p.mode === 'follow' && p.scale !== 1 ? ` · ${formatScale(p.scale)}` : ''}
      </div>
    </div>
  );
}
