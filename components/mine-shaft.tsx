"use client";

import { cn } from "@/lib/utils";

interface MineShaftProps {
  currentDepth: number; // 0-100 percentage
  maxDepth: number;
  levels: number[];
  velocity: number;
  className?: string;
}

export function MineShaft({
  currentDepth,
  maxDepth,
  levels,
  velocity,
  className,
}: MineShaftProps) {
  // Calculate the cage position (0% = top, 100% = bottom)
  const cagePosition = (currentDepth / 100) * 100;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Digital Readouts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-border rounded-sm p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-mono">
            Current Depth
          </div>
          <div className="text-2xl font-mono font-bold text-neon-green tabular-nums">
            {currentDepth.toFixed(1)}%
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {((currentDepth / 100) * maxDepth).toFixed(1)}m / {maxDepth}m
          </div>
        </div>
        <div className="bg-slate-900 border border-border rounded-sm p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-mono">
            Est. Velocity
          </div>
          <div
            className={cn(
              "text-2xl font-mono font-bold tabular-nums",
              velocity > 0
                ? "text-neon-amber"
                : velocity < 0
                  ? "text-neon-green"
                  : "text-muted-foreground"
            )}
          >
            {velocity > 0 ? "+" : ""}
            {velocity.toFixed(1)} m/s
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {velocity > 0 ? "LOWERING" : velocity < 0 ? "HOISTING" : "STOPPED"}
          </div>
        </div>
      </div>

      {/* Mine Shaft Visual */}
      <div className="relative flex-1 min-h-[400px]">
        {/* Shaft Track Background */}
        <div className="absolute inset-0 flex">
          {/* Left Rail */}
          <div className="w-3 bg-gradient-to-b from-slate-600 via-slate-700 to-slate-800 rounded-t-sm" />

          {/* Shaft Interior */}
          <div className="flex-1 relative bg-gradient-to-b from-slate-900 via-[#0a0a0f] to-[#050508] border-x border-slate-700/50">
            {/* Level Markers */}
            {levels.map((level, index) => {
              const position = (level / maxDepth) * 100;
              return (
                <div
                  key={index}
                  className="absolute left-0 right-0 flex items-center"
                  style={{ top: `${position}%` }}
                >
                  <div className="absolute -left-8 w-6 h-[2px] bg-neon-green/70" />
                  <div className="absolute -left-16 text-[10px] font-mono text-neon-green/80 whitespace-nowrap">
                    L{index + 1}
                  </div>
                  <div className="w-full h-[1px] bg-neon-green/20" />
                  <div className="absolute -right-12 text-[10px] font-mono text-muted-foreground">
                    {level}m
                  </div>
                </div>
              );
            })}

            {/* Cage - Animated position via CSS transform */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-16 transition-transform duration-100 ease-linear"
              style={{
                transform: `translateX(-50%) translateY(${cagePosition}%)`,
                top: "0",
              }}
            >
              {/* Cable */}
              <div
                className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-gradient-to-b from-slate-400 to-slate-600 -top-[400px] h-[400px]"
                style={{ height: `${cagePosition * 4}px` }}
              />

              {/* Cage Body */}
              <div className="relative">
                {/* Cage Frame */}
                <div className="w-16 h-20 border-2 border-slate-400 bg-gradient-to-b from-slate-600 via-slate-700 to-slate-800 rounded-sm shadow-lg shadow-black/50">
                  {/* Cage Top Frame */}
                  <div className="absolute -top-1 left-1 right-1 h-1 bg-slate-500 rounded-t-sm" />

                  {/* Cage Interior Grid */}
                  <div className="absolute inset-1 grid grid-cols-2 gap-[2px]">
                    <div className="bg-slate-900/80 rounded-sm" />
                    <div className="bg-slate-900/80 rounded-sm" />
                    <div className="bg-slate-900/80 rounded-sm" />
                    <div className="bg-slate-900/80 rounded-sm" />
                  </div>

                  {/* Safety Light */}
                  <div
                    className={cn(
                      "absolute -top-2 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full",
                      velocity !== 0
                        ? "bg-neon-amber animate-pulse shadow-[0_0_8px_2px] shadow-neon-amber"
                        : "bg-neon-green shadow-[0_0_6px_1px] shadow-neon-green"
                    )}
                  />
                </div>

                {/* Cage Bottom */}
                <div className="absolute -bottom-1 left-0 right-0 h-1 bg-slate-500 rounded-b-sm" />
              </div>
            </div>

            {/* Surface Indicator (Top) */}
            <div className="absolute top-0 left-0 right-0">
              <div className="h-2 bg-gradient-to-b from-neon-green/30 to-transparent" />
              <div className="text-[10px] font-mono text-neon-green absolute -top-4 left-1/2 -translate-x-1/2">
                SURFACE
              </div>
            </div>

            {/* Bottom Indicator */}
            <div className="absolute bottom-0 left-0 right-0">
              <div className="h-4 bg-gradient-to-t from-neon-red/20 to-transparent" />
              <div className="text-[10px] font-mono text-neon-red absolute -bottom-4 left-1/2 -translate-x-1/2">
                SHAFT BOTTOM
              </div>
            </div>
          </div>

          {/* Right Rail */}
          <div className="w-3 bg-gradient-to-b from-slate-600 via-slate-700 to-slate-800 rounded-t-sm" />
        </div>
      </div>
    </div>
  );
}
