"use client";

import { useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface LogEntry {
  id: string;
  timestamp: Date;
  type: "info" | "warning" | "error" | "success";
  message: string;
}

interface TelemetryLogProps {
  logs: LogEntry[];
  className?: string;
}

export function TelemetryLog({ logs, className }: TelemetryLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getTypeStyles = (type: LogEntry["type"]) => {
    switch (type) {
      case "error":
        return "text-neon-red";
      case "warning":
        return "text-neon-amber";
      case "success":
        return "text-neon-green";
      default:
        return "text-muted-foreground";
    }
  };

  const getTypePrefix = (type: LogEntry["type"]) => {
    switch (type) {
      case "error":
        return "[ERR]";
      case "warning":
        return "[WRN]";
      case "success":
        return "[OK]";
      default:
        return "[INF]";
    }
  };

  return (
    <div
      className={cn(
        "bg-[#0a0a0f] border border-border rounded-sm font-mono text-xs",
        className
      )}
    >
      {/* Terminal Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-slate-900/50">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-neon-red/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-neon-amber/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-neon-green/80" />
        </div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          System Telemetry
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
          <span className="text-[10px] text-neon-green">LIVE</span>
        </div>
      </div>

      {/* Log Content */}
      <ScrollArea className="h-[180px]">
        <div ref={scrollRef} className="p-3 space-y-1">
          {logs.length === 0 ? (
            <div className="text-muted-foreground opacity-50">
              {">"} Awaiting system events...
            </div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex gap-2">
                <span className="text-slate-600 shrink-0" suppressHydrationWarning>
                  {log.timestamp.toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className={cn("shrink-0", getTypeStyles(log.type))}>
                  {getTypePrefix(log.type)}
                </span>
                <span className="text-foreground/90">{log.message}</span>
              </div>
            ))
          )}
          <div className="text-neon-green animate-pulse">{">"}_</div>
        </div>
      </ScrollArea>
    </div>
  );
}
