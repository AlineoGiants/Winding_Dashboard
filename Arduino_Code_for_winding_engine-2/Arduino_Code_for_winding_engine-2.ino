// --- MINE WINDING ENGINE: MASTER SCADA FIRMWARE (V3.0) ---
// Features: JSON Telemetry, VFD PWM Control, Hardware Interrupts, Kinematic
// Math

#include <ArduinoJson.h>

// --- 1. HARDWARE PIN DEFINITIONS ---
const int ENCODER_PIN = 2;                    // LM393 D0 Pin (MUST be Pin 2 for Hardware Interrupt)
const int TOP_SENSOR = 4; // Top limit switch
const int BOT_SENSOR = 5; // Bottom limit switch
const int BUZZER = 6;     // Active buzzer for alarms
const int IN1_PIN = 8;    // L298N Direction 1
const int IN2_PIN = 9;    // L298N Direction 2
const int ENA_PIN = 10;   // L298N PWM Speed Control

// --- 2. KINEMATIC CONSTANTS ---
// Update these to match your exact physical wheel!
const float WHEEL_CIRCUMFERENCE_CM = 0.45; // Distance around the winding drum
const int ENCODER_SLOTS = 20;             // Holes on your black encoder disk
const float CM_PER_PULSE = WHEEL_CIRCUMFERENCE_CM / ENCODER_SLOTS;

// --- 3. SYSTEM STATE VARIABLES ---
volatile long absolutePulses = 0; // Truly independent, counts every movement
volatile long depthPulses = 0;    // Guesses direction based on motor state
String motorState = "IDLE";
bool topFault = false;
bool botFault = false;
bool softwareFault = false;

// Command (Set) Trackers
int setSpeedPWM = 0;
float setTargetDepthCm = 0.0;

// Measurement (Actual) Trackers
float measuredDepthCm = 0.0;
float measuredSpeedCmS = 0.0;

// Timers & States
unsigned long lastTelemetryTime = 0;
unsigned long lastSpeedCalcTime = 0;
long lastSpeedPulses = 0;
bool alarmActive = false;

void setup() {
  Serial.begin(9600);

  // Initialize Pins
  pinMode(ENCODER_PIN, INPUT_PULLUP);
  pinMode(TOP_SENSOR, INPUT_PULLUP);
  pinMode(BOT_SENSOR, INPUT_PULLUP);
  pinMode(BUZZER, OUTPUT);
  pinMode(IN1_PIN, OUTPUT);
  pinMode(IN2_PIN, OUTPUT);
  pinMode(ENA_PIN, OUTPUT);

  // Attach high-speed hardware interrupt for the optical encoder
  attachInterrupt(digitalPinToInterrupt(ENCODER_PIN), countPulse, FALLING);

  // Ensure motor starts off
  stopMotor();
}

void loop() {
  unsigned long currentTime = millis();

  // --- PHASE 1: HARDWARE SAFETY POLLING ---
  // Read limit switches (Active LOW means the magnet is near the sensor)
  topFault = (digitalRead(TOP_SENSOR) == LOW);
  botFault = (digitalRead(BOT_SENSOR) == LOW);

  // Hardwired override: Cut power immediately if limits are breached
  if (topFault && motorState == "HOIST") {
    stopMotor();
  }
  if (botFault && motorState == "LOWER") {
    stopMotor();
  }

  // Unified Continuous Alarm for ANY fault (Physical or Software)
  bool isFaultActive = topFault || botFault || softwareFault;

  if (isFaultActive && !alarmActive) {
    triggerAlarm();
    alarmActive = true;
  } else if (!isFaultActive && alarmActive) {
    stopAlarm();
    alarmActive = false;
  }

  // --- PHASE 2: CALCULATE KINEMATICS (SPEED & DISTANCE) ---

  // ATOMIC READ: Safely copy the volatile variables
  // so the interrupt doesn't scramble them while we do math.
  long safeAbsolutePulses;
  long safeDepthPulses;

  noInterrupts(); // Pause interrupts
  safeAbsolutePulses = absolutePulses;
  safeDepthPulses = depthPulses;
  interrupts(); // Resume interrupts immediately

  // Calculate Depth and Absolute Distance using the safe copies
  measuredDepthCm = safeDepthPulses * CM_PER_PULSE;
  float absoluteDistanceCm = safeAbsolutePulses * CM_PER_PULSE;

  // Calculate speed based on the absolute (true) movement
  if (currentTime - lastSpeedCalcTime >= 200) {
    long pulseDifference = abs(safeAbsolutePulses - lastSpeedPulses);
    float distanceMoved = pulseDifference * CM_PER_PULSE;

    measuredSpeedCmS =
        distanceMoved / ((currentTime - lastSpeedCalcTime) / 1000.0);

    lastSpeedPulses = safeAbsolutePulses;
    lastSpeedCalcTime = currentTime;
  }

  // --- PHASE 3: INCOMING NETWORK COMMANDS ---
  // Listen for JSON commands from the Node.js Server
  if (Serial.available() > 0) {
    String incomingCommand = Serial.readStringUntil('\n');

    StaticJsonDocument<200> doc;
    DeserializationError error = deserializeJson(doc, incomingCommand);

    if (!error) {
      String action = doc["action"];

      // Extract commanded variables
      setSpeedPWM = doc["speed"] | 0;
      setTargetDepthCm = doc["targetDepth"] | 0.0;

      // Execute movement if there are no faults blocking that direction
      if (action == "hoist" && !topFault) {
        analogWrite(ENA_PIN, setSpeedPWM);
        hoistMotor();
      } else if (action == "lower" && !botFault) {
        analogWrite(ENA_PIN, setSpeedPWM);
        lowerMotor();
      } else if (action == "stop" || action == "estop") {
        stopMotor();
      } else if (action == "fault_state") {
        softwareFault = doc["state"].as<bool>();
      } else if (action == "calibrate") {
        float calibDepthCm = doc["depth"] | 0.0;
        noInterrupts();
        depthPulses = calibDepthCm / CM_PER_PULSE;
        interrupts();
      }
    }
  }

  // --- PHASE 4: OUTBOUND TELEMETRY STREAMING ---
  // Blast the dual-data JSON payload up the USB cable every 100ms
  if (currentTime - lastTelemetryTime > 100) {
    lastTelemetryTime = currentTime;

    Serial.print("{\"setSpeedPWM\":");
    Serial.print(setSpeedPWM);
    Serial.print(",\"setTargetDepth\":");
    Serial.print(setTargetDepthCm);
    Serial.print(",\"measSpeedCmS\":");
    Serial.print(measuredSpeedCmS, 2);
    Serial.print(",\"measDepthCm\":");
    Serial.print(measuredDepthCm, 2);
    Serial.print(",\"topFault\":");
    Serial.print(topFault ? "true" : "false");
    Serial.print(",\"botFault\":");
    Serial.print(botFault ? "true" : "false");
    Serial.println("}");
  }
}

// --- HARDWARE CONTROL FUNCTIONS ---
void hoistMotor() {
  motorState = "HOIST";
  digitalWrite(IN1_PIN, HIGH);
  digitalWrite(IN2_PIN, LOW);
}

void lowerMotor() {
  motorState = "LOWER";
  digitalWrite(IN1_PIN, LOW);
  digitalWrite(IN2_PIN, HIGH);
}

void stopMotor() {
  motorState = "IDLE";
  digitalWrite(IN1_PIN, LOW);
  digitalWrite(IN2_PIN, LOW);
  analogWrite(ENA_PIN, 0); // Cut PWM power
  setSpeedPWM = 0;         // Reset the UI tracker
}

void triggerAlarm() {
  tone(BUZZER, 1500); // Continuous tone until stopped
}

void stopAlarm() { noTone(BUZZER); }

// --- INTERRUPT SERVICE ROUTINE ---
// Triggers instantly when the LM393 sensor detects a slot
void countPulse() {
  // 1. TRUE INDEPENDENT MEASUREMENT: Always track physical movement
  absolutePulses++;

  // 2. DIRECTIONAL ESTIMATION:
  if (motorState == "HOIST") {
    depthPulses--;
    if (depthPulses < 0)
      depthPulses = 0;
  } else if (motorState == "LOWER") {
    depthPulses++;
  } else {
    // If the motor is IDLE but the disk is spinning, the rope is slipping!
    // Gravity dictates a slip usually means the cage is falling down.
    depthPulses++;
  }
}
