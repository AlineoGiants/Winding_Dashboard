"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { io, Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { TelemetryLog, LogEntry } from "@/components/telemetry-log";
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Settings,
  Gauge,
  Wrench,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function WindingEngineDashboard() {
  // System Mode
  const [isAutonomous, setIsAutonomous] = useState(false);

  // Configuration Interdependent States
  const [configOpen, setConfigOpen] = useState(true);
  const [speedsOpen, setSpeedsOpen] = useState(true);
  
  const [maxDepth, setMaxDepth] = useState(2);
  const [numLevels, setNumLevels] = useState(5);
  const [levelInterval, setLevelInterval] = useState(0.5);

  const [targetLevel, setTargetLevel] = useState(5);

  const handleMaxDepthChange = (val: number) => {
    setMaxDepth(val);
    if (numLevels > 1) {
      setLevelInterval(val / (numLevels - 1));
    }
  };
  
  const handleLevelIntervalChange = (val: number) => {
    setLevelInterval(val);
    if (val > 0) {
      const newNum = Math.max(2, Math.round((maxDepth / val) + 1));
      setNumLevels(newNum);
      if (targetLevel > newNum) setTargetLevel(newNum);
    }
  };
  
  const handleNumLevelsChange = (val: number) => {
    const safeVal = Math.max(2, Math.round(val));
    setNumLevels(safeVal);
    setLevelInterval(maxDepth / (safeVal - 1));
    if (targetLevel > safeVal) setTargetLevel(safeVal);
  };

  // Calculate levels mathematically based on configuration
  // Equation implies L1 = 0m, L2 = interval, ... LN = Max Depth
  const levels = useMemo(() => Array.from({ length: numLevels }, (_, i) => i * levelInterval), [numLevels, levelInterval]);

  // Motor Speeds
  const [hoistSpeed, setHoistSpeed] = useState(0.8);
  const [lowerSpeed, setLowerSpeed] = useState(0.8);
  const [retreatSpeed, setRetreatSpeed] = useState(0.8);

  // Cage State
  const [currentDepth, setCurrentDepth] = useState(0);
  const currentDepthRef = useRef(0);
  useEffect(() => { currentDepthRef.current = currentDepth; }, [currentDepth]);

  const [velocity, setVelocity] = useState(0);
  const [measSpeedCmS, setMeasSpeedCmS] = useState(0);
  const [measDepthCm, setMeasDepthCm] = useState(0);
  const [isMoving, setIsMoving] = useState(false);
  const [emergencyStop, setEmergencyStop] = useState(false);
  const [manualState, setManualState] = useState<"hoist" | "lower" | "idle">("idle");
  
  // Fault State
  const [fault, setFault] = useState<"overwind" | "underwind" | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const recoveryActiveRef = useRef(false);
  const faultSourceRef = useRef<"physical" | "simulated" | null>(null);

  // WebSocket State
  const socketRef = useRef<Socket | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);

  // Automation State
  const [targetCycles, setTargetCycles] = useState(1);
  const [waitTime, setWaitTime] = useState(5);
  const [isAutoCycleRunning, setIsAutoCycleRunning] = useState(false);
  const [currentCycle, setCurrentCycle] = useState(0);
  const [autoPhase, setAutoPhase] = useState<"idle" | "lowering" | "waiting" | "hoisting">("idle");
  const autoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Telemetry Logs
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: "1",
      timestamp: new Date(),
      type: "info",
      message: "System initialized. Winding Engine Digital Twin online.",
    },
  ]);

  const addLog = useCallback(
    (type: LogEntry["type"], message: string) => {
      setLogs((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          timestamp: new Date(),
          type,
          message,
        },
      ]);
    },
    []
  );

  // Animation interval ref
  const animationRef = useRef<NodeJS.Timeout | null>(null);

  // --- WEBSOCKET CONNECTION ---
  useEffect(() => {
    // Connect to Node.js server bridge, forcing websockets to prevent polling/eval CSP issues
    const socket = io("http://localhost:3001", {
      transports: ["websocket"],
      upgrade: false
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsSocketConnected(true);
    });

    socket.on("disconnect", () => {
      setIsSocketConnected(false);
    });

    // Incoming Telemetry listener
    socket.on("telemetry", (payload: any) => {
      // Map hardware bridge payload to React state
      if (payload.currentDepth !== undefined) {
        setCurrentDepth(Number(payload.currentDepth));
      }
      if (payload.velocity !== undefined) {
        setVelocity(Number(payload.velocity));
      }
      if (payload.measSpeedCmS !== undefined) {
        setMeasSpeedCmS(Number(payload.measSpeedCmS));
      }
      if (payload.measDepthCm !== undefined) {
        setMeasDepthCm(Number(payload.measDepthCm));
      }
      if (payload.topFault === "true" || payload.topFault === true) {
        faultSourceRef.current = "physical";
        setFault(prev => prev !== "overwind" ? "overwind" : prev);
      } else if (payload.botFault === "true" || payload.botFault === true) {
        faultSourceRef.current = "physical";
        setFault(prev => prev !== "underwind" ? "underwind" : prev);
      } else {
        // Clear physical faults when both sensors are reading normal
        if (faultSourceRef.current === "physical") {
          setFault(null);
          faultSourceRef.current = null;
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Clear animation safely
  const stopCage = useCallback(() => {
    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }
    setIsMoving(false);
    setVelocity(0);
    setManualState("idle");
  }, []);

  // Movement function
  const moveCage = useCallback(
    (direction: "up" | "down", limit?: number) => {
      if (emergencyStop || isRecovering) return;
      if (direction === "up" && fault === "overwind") return;
      if (direction === "down" && fault === "underwind") return;

      setIsMoving(true);
      const speed = direction === "down" ? lowerSpeed : hoistSpeed;
      setVelocity(direction === "down" ? speed : -speed);

      if (animationRef.current) clearInterval(animationRef.current);

      animationRef.current = setInterval(() => {
        setCurrentDepth((prev) => {
          // Increment based on 50ms (0.05s) mapping to real speed
          const increment = direction === "down" ? speed * 0.05 : -(speed * 0.05);
          const newDepth = prev + increment;
          const lowerLimit = limit !== undefined ? limit : maxDepth;

          // Boundary checks
          if (direction === "up" && newDepth <= 0) {
            stopCage();
            socketRef.current?.emit("command", { action: "stop" });
            if (prev > 0) addLog("info", "Cage arrived at SURFACE level.");
            return 0;
          }
          if (direction === "down" && newDepth >= lowerLimit) {
            stopCage();
            socketRef.current?.emit("command", { action: "stop" });
            if (prev < lowerLimit) addLog("info", `Cage arrived at TARGET depth (${lowerLimit.toFixed(1)}m).`);
            return lowerLimit;
          }

          return newDepth;
        });
      }, 50);
    },
    [emergencyStop, fault, isRecovering, lowerSpeed, hoistSpeed, maxDepth, stopCage, addLog]
  );

  // Latching Manual Control Handlers
  const handleHoistToggle = () => {
    if (emergencyStop || isRecovering || isAutonomous) return;
    if (fault === "overwind") return;
    if (manualState === "hoist") {
      addLog("info", "Manual HOIST stopped.");
      socketRef.current?.emit("command", { action: "stop" });
      stopCage();
    } else {
      stopCage(); // clear any lower state
      setManualState("hoist");
      addLog("info", "Manual HOIST engaged (Continuous Latch).");
      socketRef.current?.emit("command", { action: "hoist", speed: Math.min(hoistSpeed * 50, 255) });
      moveCage("up");
    }
  };

  const handleLowerToggle = () => {
    if (emergencyStop || isRecovering || isAutonomous) return;
    if (fault === "underwind") return;
    if (manualState === "lower") {
      addLog("info", "Manual LOWER stopped.");
      socketRef.current?.emit("command", { action: "stop" });
      stopCage();
    } else {
      stopCage(); // clear any hoist state
      setManualState("lower");
      addLog("info", "Manual LOWER engaged (Continuous Latch).");
      socketRef.current?.emit("command", { action: "lower", speed: Math.min(lowerSpeed * 50, 255) });
      moveCage("down");
    }
  };

  const handleEmergencyStop = () => {
    stopCage();
    setEmergencyStop(true);
    setIsAutoCycleRunning(false);
    setAutoPhase("idle");
    if (autoTimeoutRef.current) {
      clearTimeout(autoTimeoutRef.current);
      autoTimeoutRef.current = null;
    }
    socketRef.current?.emit("command", { action: "estop" });
    socketRef.current?.emit("command", { action: "fault_state", state: false });
    addLog("error", "!!! EMERGENCY STOP ACTIVATED !!! - All operations halted");
  };

  const resetEmergencyStop = () => {
    if (isRecovering) {
      addLog("error", "Cannot reset E-Stop during Autonomous Fault Recovery!");
      return;
    }
    setEmergencyStop(false);
    setFault(null);
    faultSourceRef.current = null;
    socketRef.current?.emit("command", { action: "fault_state", state: false });
    addLog("success", "Emergency stop reset - System ready");
  };

  // --- AUTONOMOUS HOISTING STATE MACHINE ---
  useEffect(() => {
    if (!isAutoCycleRunning || emergencyStop || fault) return;

    if (autoPhase === "lowering") {
      const targetPhysicalDepth = (targetLevel - 1) * levelInterval;
      if (currentDepth >= targetPhysicalDepth) {
        stopCage();
        socketRef.current?.emit("command", { action: "stop" });
        setAutoPhase("waiting");
      }
    } else if (autoPhase === "waiting") {
      if (autoTimeoutRef.current) return;
      
      addLog("info", `Waiting at L${targetLevel} for ${waitTime}s...`);
      autoTimeoutRef.current = setTimeout(() => {
        autoTimeoutRef.current = null;
        setAutoPhase("hoisting");
        addLog("info", `Cycle ${currentCycle + 1}/${targetCycles}: Hoisting cage...`);
        moveCage("up");
        socketRef.current?.emit("command", { action: "hoist", speed: Math.min(hoistSpeed * 50, 255) });
      }, waitTime * 1000);
    } else if (autoPhase === "hoisting") {
      if (currentDepth <= 0) {
        stopCage();
        socketRef.current?.emit("command", { action: "stop" });
        
        const nextCycle = currentCycle + 1;
        setCurrentCycle(nextCycle);
        
        if (nextCycle < targetCycles) {
          setAutoPhase("lowering");
          addLog("info", `Cycle ${nextCycle + 1}/${targetCycles}: Lowering to L${targetLevel}...`);
          const targetPhysicalDepth = (targetLevel - 1) * levelInterval;
          moveCage("down", targetPhysicalDepth);
          socketRef.current?.emit("command", { action: "lower", speed: Math.min(lowerSpeed * 50, 255) });
        } else {
          setIsAutoCycleRunning(false);
          setAutoPhase("idle");
          addLog("success", "Auto-cycle completed successfully");
        }
      }
    }
  }, [currentDepth, autoPhase, isAutoCycleRunning, emergencyStop, fault, targetLevel, levelInterval, waitTime, currentCycle, targetCycles, hoistSpeed, lowerSpeed, addLog, moveCage, stopCage]);

  // Auto Cycle
  const startAutoCycle = () => {
    if (emergencyStop || isAutoCycleRunning || fault || isRecovering) return;

    setIsAutoCycleRunning(true);
    setCurrentCycle(0);
    setAutoPhase("lowering");
    
    const targetPhysicalDepth = (targetLevel - 1) * levelInterval;
    addLog("info", `Auto-cycle started: ${targetCycles} cycles to L${targetLevel} (${targetPhysicalDepth.toFixed(1)}m)`);
    addLog("info", `Cycle 1/${targetCycles}: Lowering to L${targetLevel}...`);
    
    moveCage("down", targetPhysicalDepth);
    socketRef.current?.emit("command", { action: "lower", speed: Math.min(lowerSpeed * 50, 255) });
  };

  // Unified Fault Handling Sequence (Triggered by hardware telemetry OR software simulation)
  useEffect(() => {
    if (fault === "overwind" || fault === "underwind") {
      if (recoveryActiveRef.current) return;
      recoveryActiveRef.current = true;
      
      const handleFault = async () => {
        setIsRecovering(true);
        stopCage();
        setIsAutoCycleRunning(false);
        if (autoTimeoutRef.current) { clearTimeout(autoTimeoutRef.current); autoTimeoutRef.current = null; }
        
        setVelocity(0);
        addLog("error", `!!! ${fault.toUpperCase()} FAULT DETECTED !!! - Cage breached safety boundaries.`);
        
        if (faultSourceRef.current === "physical") {
          addLog("warning", "Catastrophic braking engaged. Motion stopped due to physical sensor.");
          socketRef.current?.emit("command", { action: "stop" });
          setIsRecovering(false);
          recoveryActiveRef.current = false;
          return;
        }

        socketRef.current?.emit("command", { action: "fault_state", state: true });
        
        addLog("warning", "Catastrophic braking engaged. Initiating autonomous recovery...");
        
        let targetDepth = 0;
        if (fault === "overwind") {
            targetDepth = levels[0];
            socketRef.current?.emit("command", { action: "calibrate", depth: currentDepthRef.current * 100 });
        } else {
            targetDepth = maxDepth;
            socketRef.current?.emit("command", { action: "calibrate", depth: currentDepthRef.current * 100 });
        }
        
        // Temporarily halt motion for 3 seconds before retreating
        addLog("info", "System halted. Waiting 3 seconds before recovery...");
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const recoveryDirection = fault === "overwind" ? "down" : "up";
        setVelocity(recoveryDirection === "down" ? retreatSpeed : -retreatSpeed);
        
        socketRef.current?.emit("command", { 
            action: recoveryDirection === "down" ? "lower" : "hoist", 
            speed: Math.min(retreatSpeed * 50, 255) 
        });
        
        await new Promise<void>(resolve => {
          const recoveryInterval = setInterval(() => {
            setCurrentDepth(prev => {
              const increment = recoveryDirection === "down" ? retreatSpeed * 0.05 : -(retreatSpeed * 0.05);
              const newDepth = prev + increment;
              
              if ((recoveryDirection === "down" && newDepth >= targetDepth) || (recoveryDirection === "up" && newDepth <= targetDepth)) {
                clearInterval(recoveryInterval);
                resolve();
                return targetDepth; // precisely clamp to safe level
              }
              return newDepth;
            });
          }, 50);
        });
        
        // Stabilized
        socketRef.current?.emit("command", { action: "stop" });
        socketRef.current?.emit("command", { action: "fault_state", state: false });
        setVelocity(0);
        setFault(null);
        setIsRecovering(false);
        recoveryActiveRef.current = false;
        addLog("success", `System stabilized at L${levels.indexOf(targetDepth) + 1} (${targetDepth.toFixed(1)}m). Fault cleared.`);
      };
      
      handleFault();
    }
  }, [fault, levels, levelInterval, maxDepth, retreatSpeed, addLog, stopCage]);

  // Software Fallback Crash Simulator
  const simulateFault = (type: "overwind" | "underwind") => {
    if (emergencyStop || fault || isRecovering) return;
    stopCage();
    setIsAutoCycleRunning(false);
    setIsRecovering(true); // Lock manual controls
    
    addLog("warning", `Simulating ${type.toUpperCase()}... Loss of control!`);
    socketRef.current?.emit("command", { action: "fault_state", state: true });
    
    const runawayDirection = type === "overwind" ? "up" : "down";
    const runawaySpeed = type === "overwind" ? hoistSpeed : lowerSpeed;
    const faultDepth = type === "overwind" ? -0.25 : maxDepth + 0.25;
    
    socketRef.current?.emit("command", { 
        action: runawayDirection === "down" ? "lower" : "hoist", 
        speed: Math.min(runawaySpeed * 50, 255) 
    });
    
    setVelocity(runawayDirection === "down" ? runawaySpeed : -runawaySpeed);
    
    const driveInterval = setInterval(() => {
      setCurrentDepth(prev => {
        const increment = runawayDirection === "down" ? runawaySpeed * 0.05 : -(runawaySpeed * 0.05);
        const newDepth = prev + increment;
        
        if ((runawayDirection === "down" && newDepth >= faultDepth) || (runawayDirection === "up" && newDepth <= faultDepth)) {
          clearInterval(driveInterval);
          socketRef.current?.emit("command", { action: "stop" }); // Actually stop the runaway motor
          
          // If hardware didn't trigger fault via telemetry, software forces it here
          faultSourceRef.current = "simulated";
          setFault(type);
          return faultDepth;
        }
        return newDepth;
      });
    }, 50);
    
    animationRef.current = driveInterval; 
  };

  const simulateOverWind = () => simulateFault("overwind");
  const simulateUnderWind = () => simulateFault("underwind");

  // Save Config
  const handleSaveConfig = () => {
    addLog("success", `Configuration saved: ${maxDepth.toFixed(1)}m depth, ${numLevels} levels, ${levelInterval.toFixed(1)}m interval.`);
  };
  
  // Save Speeds
  const handleSaveSpeeds = () => {
    addLog("success", `Motor Profile saved: Hoist ${hoistSpeed.toFixed(1)}m/s, Lower ${lowerSpeed.toFixed(1)}m/s, Retreat ${retreatSpeed.toFixed(1)}m/s.`);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) clearInterval(animationRef.current);
    };
  }, []);

  return (
    <div className={cn("min-h-screen transition-colors duration-500", fault ? "bg-red-950/40 animate-[pulse_2s_ease-in-out_infinite]" : "bg-background")}>
      {/* Top Header */}
      <header className="border-b border-border bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center justify-between px-4 py-3 max-w-[1800px] mx-auto">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Gauge className={cn("w-6 h-6", fault ? "text-neon-red" : "text-neon-green")} />
              <h1 className="text-lg font-mono font-bold tracking-wider text-foreground hidden sm:block">
                {fault ? (
                  <span className="text-neon-red animate-pulse">CRITICAL FAULT DETECTED</span>
                ) : (
                  <>
                    WINDING ENGINE <span className="text-muted-foreground">//</span> <span className="text-neon-green">DIGITAL TWIN</span>
                  </>
                )}
              </h1>
            </div>
            {/* Status Indicator */}
            <div className="flex items-center gap-2 px-3 py-1 bg-slate-800 rounded-sm border border-border">
              <div
                className={cn(
                  "w-2 h-2 rounded-full",
                  fault 
                    ? "bg-neon-red shadow-[0_0_8px_2px_rgba(255,50,50,0.8)] animate-bounce"
                    : emergencyStop
                    ? "bg-neon-red animate-pulse"
                    : isRecovering
                      ? "bg-neon-amber shadow-[0_0_6px_1px_rgba(255,170,0,0.8)] animate-pulse"
                      : isMoving
                        ? "bg-neon-amber animate-pulse"
                        : "bg-neon-green",
                  isRecovering && fault === null && "bg-neon-amber shadow-[0_0_6px_1px_rgba(255,170,0,0.8)]"
                )}
              />
              <span className={cn("text-xs font-mono font-bold", fault && "text-neon-red")}>
                {fault ? `FAULT: ${fault.toUpperCase()}` : isRecovering ? "AUTO-RECOVERY" : emergencyStop ? "E-STOP" : isMoving ? "ACTIVE" : "READY"}
              </span>
            </div>
          </div>

          {/* System Mode Toggle */}
          <div className="flex items-center gap-3 px-4 py-2 bg-slate-800 rounded-sm border border-border">
            <span
              className={cn(
                "text-xs font-mono uppercase tracking-wider",
                !isAutonomous ? "text-neon-green" : "text-muted-foreground"
              )}
            >
              Manual
            </span>
            <Switch
              checked={isAutonomous}
              onCheckedChange={(checked) => {
                setIsAutonomous(checked);
                addLog(
                  "info",
                  `System mode changed to ${checked ? "AUTONOMOUS" : "MANUAL"}`
                );
              }}
              disabled={fault !== null || isRecovering || emergencyStop}
              className="data-[state=checked]:bg-neon-green data-[state=disabled]:opacity-50"
            />
            <span
              className={cn(
                "text-xs font-mono uppercase tracking-wider",
                isAutonomous ? "text-neon-green" : "text-muted-foreground"
              )}
            >
              Autonomous
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto p-4 space-y-4 relative z-10">
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Configuration Panel - Collapsible */}
          <Collapsible open={configOpen} onOpenChange={setConfigOpen}>
            <div className="bg-card border border-border rounded-sm h-full">
              <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-mono uppercase tracking-wider text-foreground">
                    System Configuration
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    (Minimizable)
                  </span>
                </div>
                {configOpen ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 border-t border-border pt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end mb-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                        Max Shaft Depth (m)
                      </Label>
                      <Input
                        type="number"
                        value={maxDepth}
                        onChange={(e) => handleMaxDepthChange(Number(e.target.value))}
                        className="font-mono bg-slate-900 border-slate-700"
                        min={1}
                        step={0.5}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                        Level Interval (m)
                      </Label>
                      <Input
                        type="number"
                        value={levelInterval}
                        onChange={(e) => handleLevelIntervalChange(Number(e.target.value))}
                        className="font-mono bg-slate-900 border-slate-700"
                        min={0.1}
                        step={0.1}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                        Number of Levels
                      </Label>
                      <Input
                        type="number"
                        value={numLevels}
                        onChange={(e) => handleNumLevelsChange(Number(e.target.value))}
                        className="font-mono bg-slate-900 border-slate-700"
                        min={2}
                        step={1}
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleSaveConfig}
                    className="w-full bg-neon-green/20 text-neon-green border border-neon-green/50 hover:bg-neon-green/30 font-mono uppercase tracking-wider"
                    disabled={fault !== null || isRecovering}
                  >
                    Save Config
                  </Button>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          {/* Motor Speeds Panel - Collapsible */}
          <Collapsible open={speedsOpen} onOpenChange={setSpeedsOpen}>
            <div className="bg-card border border-border rounded-sm h-full">
              <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-mono uppercase tracking-wider text-foreground">
                    Motor Profile
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    (Minimizable)
                  </span>
                </div>
                {speedsOpen ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 border-t border-border pt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end mb-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-mono uppercase tracking-wider text-neon-green">
                        Hoist Speed (m/s)
                      </Label>
                      <Input
                        type="number"
                        value={hoistSpeed}
                        onChange={(e) => setHoistSpeed(Number(e.target.value))}
                        className="font-mono bg-slate-900 border-slate-700 text-neon-green"
                        min={0.1}
                        step={0.5}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-mono uppercase tracking-wider text-neon-amber">
                        Lower Speed (m/s)
                      </Label>
                      <Input
                        type="number"
                        value={lowerSpeed}
                        onChange={(e) => setLowerSpeed(Number(e.target.value))}
                        className="font-mono bg-slate-900 border-slate-700 text-neon-amber"
                        min={0.1}
                        step={0.5}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                        Retreat Speed (m/s)
                      </Label>
                      <Input
                        type="number"
                        value={retreatSpeed}
                        onChange={(e) => setRetreatSpeed(Number(e.target.value))}
                        className="font-mono bg-slate-900 border-slate-700"
                        min={0.1}
                        step={0.5}
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleSaveSpeeds}
                    className="w-full bg-slate-800 text-foreground border border-border hover:bg-slate-700 font-mono uppercase tracking-wider"
                    disabled={fault !== null || isRecovering}
                  >
                    Set Motor Speeds
                  </Button>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>

        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Panel - Unifed Inlined Digital Twin Visual */}
          <div className="lg:col-span-4 bg-card border border-border rounded-sm p-4 relative overflow-hidden">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border relative z-10">
              <Gauge className="w-4 h-4 text-neon-green" />
              <h2 className="text-sm font-mono uppercase tracking-wider text-foreground">
                Digital Twin Visual
              </h2>
            </div>
            
            {/* Visual Shaft Content inline logic */}
            <div className="flex flex-col gap-4 h-full min-h-[550px] relative z-10">
              {/* Digital Readouts */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900 border border-border rounded-sm p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-mono">
                    Est. Depth
                  </div>
                  <div className={cn("text-2xl font-mono font-bold tabular-nums", fault ? "text-neon-red" : "text-neon-green")}>
                    {currentDepth.toFixed(2)} m
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    of {maxDepth.toFixed(1)} m max
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
                    {velocity.toFixed(2)} m/s
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {velocity > 0 ? "LOWERING" : velocity < 0 ? "HOISTING" : "STOPPED"}
                  </div>
                </div>
                <div className="bg-slate-900 border border-cyan-900/50 rounded-sm p-3">
                  <div className="text-[10px] uppercase tracking-wider text-cyan-500 mb-1 font-mono">
                    Measured Depth
                  </div>
                  <div className="text-2xl font-mono font-bold tabular-nums text-cyan-400">
                    {measDepthCm.toFixed(2)} m
                  </div>
                  <div className="text-xs text-cyan-700 font-mono">
                    Hardware Sensor
                  </div>
                </div>
                <div className="bg-slate-900 border border-cyan-900/50 rounded-sm p-3">
                  <div className="text-[10px] uppercase tracking-wider text-cyan-500 mb-1 font-mono">
                    Measured Speed
                  </div>
                  <div className="text-2xl font-mono font-bold tabular-nums text-cyan-400">
                    {measSpeedCmS.toFixed(2)} m/s
                  </div>
                  <div className="text-xs text-cyan-700 font-mono">
                    Hardware Sensor
                  </div>
                </div>
              </div>

              {/* Graphical Mine Shaft Visual */}
              <div className="relative flex-1 min-h-[400px] mt-2 border-t-2 border-dashed border-slate-800 pt-8 pb-8 overflow-hidden">
                {/* Shaft Track Background */}
                <div className="absolute top-24 bottom-12 inset-x-0 mx-auto w-32 flex justify-center">
                  {/* Left Rail */}
                  <div className="w-3 bg-gradient-to-b from-slate-600 via-slate-700 to-slate-800 rounded-t-sm shadow-inner" />

                  {/* Shaft Interior */}
                  <div className="flex-1 relative bg-gradient-to-b from-slate-900 via-[#0a0a0f] to-[#050508] border-x border-slate-700/50 h-full">
                    
                    {/* Level Markers */}
                    {levels.map((level, index) => {
                      const positionPerc = (level / maxDepth) * 100;
                      return (
                        <div
                          key={index}
                          className="absolute left-0 right-0 flex items-center z-0"
                          style={{ top: `${positionPerc}%` }}
                        >
                          <div className="absolute -left-8 w-6 h-[2px] bg-neon-green/70" />
                          <div className="absolute -left-16 text-[10px] font-mono text-neon-green/80 whitespace-nowrap">
                            L{index + 1}
                          </div>
                          <div className="w-full h-[1px] bg-neon-green/20" />
                          <div className="absolute -right-16 text-[10px] font-mono text-muted-foreground bg-slate-900 px-1 rounded-sm">
                            {(level).toFixed(1)}m
                          </div>
                        </div>
                      );
                    })}

                    {/* Cage - Animated position perfectly anchoring its BOTTOM edge to the specified calculated depth line */}
                    <div
                      className="absolute left-1/2 w-16 transition-all duration-75 ease-linear z-10"
                      style={{
                        top: `${(currentDepth / maxDepth) * 100}%`,
                        transform: `translateX(-50%) translateY(-100%)`, 
                      }}
                    >
                      {/* Cable */}
                      <div
                        className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-gradient-to-b from-slate-400 to-slate-600 border-x border-slate-900/50 shadow-inner"
                        style={{ height: `800px`, bottom: "100%" }}
                      />

                      {/* Cage Body Offset. */}
                      <div className="relative">
                        {/* Cage Frame */}
                        <div className={cn("w-16 h-20 border-2 bg-gradient-to-b rounded-sm shadow-xl transition-colors duration-300", fault ? "border-neon-red from-red-900 to-slate-900 shadow-[0_0_15px_rgba(255,50,50,0.5)]" : "border-slate-400 from-slate-600 via-slate-700 to-slate-800 shadow-black/50")}>
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
                              "absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border border-black/50",
                              fault ? "bg-neon-red shadow-[0_0_12px_4px] shadow-neon-red animate-[ping_0.5s_infinite]"
                               : velocity !== 0
                                ? "bg-neon-amber animate-[pulse_0.5s_infinite] shadow-[0_0_8px_2px] shadow-neon-amber"
                                : "bg-neon-green shadow-[0_0_6px_1px] shadow-neon-green"
                            )}
                          />
                        </div>

                        {/* Cage Bottom */}
                        <div className="absolute -bottom-1 left-0 right-0 h-1 bg-slate-500 rounded-b-sm" />
                      </div>
                    </div>

                    {/* Surface Indicator (Top) */}
                    <div className="absolute top-0 left-0 right-0 z-0">
                      <div className="h-[2px] bg-gradient-to-r from-transparent via-neon-green to-transparent" />
                      <div className="text-[10px] font-mono text-neon-green absolute -top-4 left-1/2 -translate-x-1/2 bg-slate-950 px-1 border border-neon-green/30 rounded-sm whitespace-nowrap">
                        SURFACE 0m
                      </div>
                    </div>

                    {/* Bottom Indicator */}
                    <div className="absolute bottom-0 left-0 right-0 z-0">
                      <div className="h-[2px] bg-gradient-to-r from-transparent via-neon-amber to-transparent" />
                      <div className="text-[10px] font-mono whitespace-nowrap text-neon-amber absolute border-neon-amber/30 -bottom-5 left-1/2 -translate-x-1/2 bg-slate-950 px-1 border rounded-sm">
                        SHAFT BOTTOM {(maxDepth).toFixed(1)}m
                      </div>
                    </div>

                  </div>

                  {/* Right Rail */}
                  <div className="w-3 bg-gradient-to-b from-slate-600 via-slate-700 to-slate-800 rounded-t-sm shadow-inner" />
                </div>
              </div>
            </div>
            
            {/* Fault Overlay Tint Component */}
            {fault && (
              <div className="absolute inset-0 z-0 bg-neon-red/10 animate-[pulse_1s_infinite] pointer-events-none transition-opacity duration-300" />
            )}
          </div>

          {/* Center Panel - Automation & Demo */}
          <div className="lg:col-span-5 space-y-4">
            {/* Batch Hoisting Setup */}
            <div className="bg-card border border-border rounded-sm p-4">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
                <Settings className="w-4 h-4 text-neon-green" />
                <h2 className="text-sm font-mono uppercase tracking-wider text-foreground">
                  Batch Hoisting Setup
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div className="space-y-2">
                  <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    Target Cycle Level
                  </Label>
                  <Input
                    type="number"
                    value={targetLevel}
                    onChange={(e) => setTargetLevel(Math.min(numLevels, Math.max(1, Number(e.target.value))))}
                    className="font-mono bg-slate-900 border-slate-700 text-neon-green"
                    min={1}
                    max={numLevels}
                    step={1}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    Target Cycles
                  </Label>
                  <Input
                    type="number"
                    value={targetCycles}
                    onChange={(e) => setTargetCycles(Math.max(1, Number(e.target.value)))}
                    className="font-mono bg-slate-900 border-slate-700"
                    min={1}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    Wait Time (s)
                  </Label>
                  <Input
                    type="number"
                    value={waitTime}
                    onChange={(e) => setWaitTime(Math.max(1, Number(e.target.value)))}
                    className="font-mono bg-slate-900 border-slate-700"
                    min={1}
                  />
                </div>
              </div>
              <Button
                onClick={startAutoCycle}
                disabled={emergencyStop || isAutoCycleRunning || !isAutonomous || fault !== null || isRecovering}
                className={cn(
                  "w-full h-14 font-mono text-lg uppercase tracking-wider transition-all",
                  isAutoCycleRunning
                    ? "bg-neon-amber/20 text-neon-amber border-2 border-neon-amber animate-pulse hover:bg-neon-amber/20"
                    : "bg-neon-green/20 text-neon-green border-2 border-neon-green hover:bg-neon-green/30"
                )}
              >
                {isAutoCycleRunning ? "Cycle in Progress..." : "Execute Auto-Cycle"}
              </Button>
              {!isAutonomous && (
                <p className="text-[10px] text-muted-foreground mt-2 font-mono">
                  * Switch to AUTONOMOUS mode to enable auto-cycle
                </p>
              )}
            </div>

            {/* Demo Mode */}
            <div className={cn("bg-card border-2 rounded-sm overflow-hidden relative transition-colors duration-300", fault ? "border-neon-red/80" : "border-neon-amber/50")}>
              {fault && <div className="absolute inset-0 bg-neon-red/10 animate-pulse pointer-events-none" />}
              {/* Hazard Stripe Header */}
              <div
                className="h-3"
                style={{
                  background:
                    "repeating-linear-gradient(45deg, oklch(0.75 0.18 80), oklch(0.75 0.18 80) 10px, oklch(0.12 0.005 250) 10px, oklch(0.12 0.005 250) 20px)",
                }}
              />
              <div className="p-4 relative z-10">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className={cn("w-5 h-5", fault ? "text-neon-red animate-ping" : "text-neon-amber")} />
                  <h2 className={cn("text-sm font-mono uppercase tracking-wider", fault ? "text-neon-red font-bold" : "text-neon-amber")}>
                    Demo Mode
                  </h2>
                </div>
                <p className="text-[10px] text-muted-foreground mb-4 font-mono">
                  Simulate fault conditions for demonstration purposes only. Initiates multi-stage failure event rendering recovery sequences.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    onClick={simulateOverWind}
                    disabled={fault !== null || isRecovering || emergencyStop || isMoving}
                    className="h-12 bg-neon-red/20 text-neon-red border-2 border-neon-red/50 hover:bg-neon-red/30 font-mono uppercase tracking-wider text-xs whitespace-normal px-2 text-center disabled:opacity-30 disabled:border-slate-800"
                  >
                    Simulate Over-Wind
                  </Button>
                  <Button
                    onClick={simulateUnderWind}
                    disabled={fault !== null || isRecovering || emergencyStop || isMoving}
                    className="h-12 bg-neon-red/20 text-neon-red border-2 border-neon-red/50 hover:bg-neon-red/30 font-mono uppercase tracking-wider text-xs whitespace-normal px-2 text-center disabled:opacity-30 disabled:border-slate-800"
                  >
                    Simulate Under-Wind
                  </Button>
                </div>
              </div>
              {/* Bottom Hazard Stripe */}
              <div
                className="h-3 relative z-10"
                style={{
                  background:
                    "repeating-linear-gradient(45deg, oklch(0.75 0.18 80), oklch(0.75 0.18 80) 10px, oklch(0.12 0.005 250) 10px, oklch(0.12 0.005 250) 20px)",
                }}
              />
            </div>
          </div>

          {/* Right Panel - Manual Override */}
          <div className="lg:col-span-3 bg-card border border-border rounded-sm p-4 relative">
             {fault && <div className="absolute inset-0 bg-neon-red/5 animate-pulse rounded-sm pointer-events-none" />}
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border relative z-10">
              <Wrench className="w-4 h-4 text-neon-green" />
              <h2 className="text-sm font-mono uppercase tracking-wider text-foreground">
                Manual Override
              </h2>
            </div>
            <div className="space-y-4 relative z-10">
              {/* Hoist Toggle Button */}
              <Button
                onClick={handleHoistToggle}
                disabled={emergencyStop || isAutonomous || fault !== null || isRecovering}
                className={cn(
                  "w-full h-20 text-2xl font-mono font-bold uppercase tracking-wider transition-all",
                  manualState === "hoist"
                    ? "bg-neon-green/20 border-4 border-neon-green text-neon-green shadow-[0_0_15px_rgba(0,255,100,0.4)]"
                    : "bg-slate-800 border-2 border-slate-600 hover:bg-slate-700 active:bg-neon-green/30 active:border-neon-green",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <ChevronUp className="w-8 h-8 mr-2" />
                HOIST
              </Button>

              {/* Lower Toggle Button */}
              <Button
                onClick={handleLowerToggle}
                disabled={emergencyStop || isAutonomous || fault !== null || isRecovering}
                className={cn(
                  "w-full h-20 text-2xl font-mono font-bold uppercase tracking-wider transition-all",
                  manualState === "lower"
                    ? "bg-neon-amber/20 border-4 border-neon-amber text-neon-amber shadow-[0_0_15px_rgba(255,170,0,0.4)]"
                    : "bg-slate-800 border-2 border-slate-600 hover:bg-slate-700 active:bg-neon-amber/30 active:border-neon-amber",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <ChevronDown className="w-8 h-8 mr-2" />
                LOWER
              </Button>

              {/* Emergency Stop */}
              <div className="pt-4 border-t border-border">
                {!emergencyStop ? (
                  <Button
                    onClick={handleEmergencyStop}
                    disabled={fault !== null || isRecovering}
                    title={isRecovering ? "Cannot engage manual stop during Auto-Recovery" : ""}
                    className={cn(
                      "w-full h-24 text-2xl font-mono font-bold uppercase tracking-wider",
                      "bg-neon-red text-destructive-foreground border-4 border-neon-red",
                      "hover:bg-neon-red/90 hover:shadow-[0_0_30px_5px] hover:shadow-neon-red/50",
                      "active:scale-95 transition-all",
                      "shadow-[0_0_20px_2px] shadow-neon-red/30 focus:outline-none disabled:opacity-30 disabled:scale-100 disabled:shadow-none"
                    )}
                  >
                    EMERGENCY STOP
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="w-full h-24 flex items-center justify-center bg-neon-red/20 border-4 border-neon-red rounded-sm animate-[pulse_1s_infinite]">
                      <span className="text-xl font-mono font-bold text-neon-red uppercase tracking-wider">
                        E-STOP ACTIVE
                      </span>
                    </div>
                    <Button
                      onClick={resetEmergencyStop}
                      disabled={fault !== null || isRecovering}
                      className="w-full h-10 bg-neon-green/20 text-neon-green border-2 border-neon-green hover:bg-neon-green/30 font-mono uppercase tracking-wider"
                    >
                      Reset E-Stop
                    </Button>
                  </div>
                )}
              </div>

              {isAutonomous && (
                <p className="text-[10px] text-muted-foreground font-mono text-center">
                  * Manual controls disabled in AUTONOMOUS mode
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Panel - Telemetry Log */}
        <TelemetryLog logs={logs} className="w-full relative z-10" />
      </main>
    </div>
  );
}
