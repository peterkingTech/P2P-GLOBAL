import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import type { Season, Weather } from "@/lib/hemisphereSeason";

export type EnvironmentSetting = "auto" | "garden" | "mountain" | "countryside" | "forest" | "riverside";

interface TreeEnvironmentProps {
  width: number;
  height: number;
  season: Season;
  weather: Weather;
  setting: EnvironmentSetting;
  reducedMotion?: boolean;
}

const SKY_GRADIENTS: Record<Season, [string, string]> = {
  spring: ["#BEE3F5", "#EAF7E8"],
  summer: ["#8FCBF0", "#F3F8E8"],
  autumn: ["#F0C79A", "#FBEADD"],
  winter: ["#CBD9E8", "#F0F4F8"],
  dry: ["#F5DDA0", "#FBF3DE"],
  wet: ["#A9C7D6", "#E7F0EE"],
};

const GROUND_COLOR: Record<Season, string> = {
  spring: "#6E9C4A",
  summer: "#5E9A3F",
  autumn: "#A97C3E",
  winter: "#D8E2E8",
  dry: "#B99A57",
  wet: "#4E8A52",
};

// Weather dims the sky slightly and adds a light overlay — kept subtle
// throughout (spec: "My Tree is NOT a weather app").
const WEATHER_OVERLAY: Partial<Record<Weather, string>> = {
  cloudy: "rgba(120,130,140,0.12)",
  fog: "rgba(200,205,210,0.35)",
  light_rain: "rgba(60,80,100,0.10)",
};

function SettingProps({ setting, width, height, groundY }: { setting: EnvironmentSetting; width: number; height: number; groundY: number }) {
  // Lightweight background silhouettes distinguishing the user-selectable
  // settings — cosmetic only, purely additive to the base sky/ground.
  switch (setting) {
    case "mountain":
      return (
        <Path
          d={`M 0 ${groundY - 30} L ${width * 0.22} ${groundY - 90} L ${width * 0.4} ${groundY - 30} L ${width * 0.6} ${groundY - 110} L ${width * 0.82} ${groundY - 30} L ${width} ${groundY - 50} L ${width} ${groundY} L 0 ${groundY} Z`}
          fill="rgba(120,130,145,0.35)"
        />
      );
    case "forest":
      return (
        <>
          {[0.1, 0.25, 0.7, 0.85, 0.95].map((f, i) => (
            <Path
              key={i}
              d={`M ${width * f} ${groundY} L ${width * f - 14} ${groundY - 44 - (i % 2) * 10} L ${width * f + 14} ${groundY - 44 - (i % 2) * 10} Z`}
              fill="rgba(46,90,58,0.4)"
            />
          ))}
        </>
      );
    case "riverside":
      return <Rect x={0} y={groundY - 10} width={width} height={22} rx={11} fill="rgba(120,180,200,0.4)" />;
    case "countryside":
      return (
        <Path
          d={`M 0 ${groundY} L ${width} ${groundY}`}
          stroke="rgba(160,140,90,0.4)"
          strokeWidth={3}
          strokeDasharray="10 8"
        />
      );
    case "garden":
      return (
        <>
          {[0.15, 0.3, 0.68, 0.82].map((f, i) => (
            <Circle key={i} cx={width * f} cy={groundY - 6} r={5} fill={i % 2 === 0 ? "#E88AAE" : "#F2C14E"} opacity={0.6} />
          ))}
        </>
      );
    default:
      return null;
  }
}

function WeatherLayer({ weather, width, height, reducedMotion }: { weather: Weather; width: number; height: number; reducedMotion?: boolean }) {
  if (reducedMotion) return null;
  if (weather === "light_rain") {
    const drops = useMemo(
      () => Array.from({ length: 14 }, (_, i) => ({ x: (i * 37 + 13) % width, y: (i * 53) % height, len: 10 + (i % 3) * 4 })),
      [width, height]
    );
    return (
      <>
        {drops.map((d, i) => (
          <Path key={i} d={`M ${d.x} ${d.y} l -4 ${d.len}`} stroke="rgba(120,150,180,0.35)" strokeWidth={1.5} strokeLinecap="round" />
        ))}
      </>
    );
  }
  if (weather === "snow") {
    const flakes = useMemo(
      () => Array.from({ length: 18 }, (_, i) => ({ x: (i * 41 + 9) % width, y: (i * 31 + 6) % height, r: 1.5 + (i % 3) })),
      [width, height]
    );
    return (
      <>
        {flakes.map((f, i) => (
          <Circle key={i} cx={f.x} cy={f.y} r={f.r} fill="#fff" opacity={0.85} />
        ))}
      </>
    );
  }
  return null;
}

export default function TreeEnvironment({ width, height, season, weather, setting, reducedMotion }: TreeEnvironmentProps) {
  const groundY = height * 0.82;
  const [skyTop, skyBottom] = SKY_GRADIENTS[season];
  const groundColor = GROUND_COLOR[season];
  const overlay = WEATHER_OVERLAY[weather];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={skyTop} />
            <Stop offset="100%" stopColor={skyBottom} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#skyGrad)" />
        {weather === "sunny" && <Circle cx={width * 0.78} cy={height * 0.16} r={18} fill="rgba(255,236,170,0.85)" />}
        {(weather === "cloudy" || weather === "fog") && (
          <>
            <Ellipse cx={width * 0.3} cy={height * 0.15} rx={30} ry={12} fill="rgba(255,255,255,0.55)" />
            <Ellipse cx={width * 0.62} cy={height * 0.22} rx={24} ry={10} fill="rgba(255,255,255,0.45)" />
          </>
        )}
        <SettingProps setting={setting} width={width} height={height} groundY={groundY} />
        <Rect x={0} y={groundY} width={width} height={height - groundY} fill={groundColor} />
        <WeatherLayer weather={weather} width={width} height={height} reducedMotion={reducedMotion} />
        {overlay && <Rect x={0} y={0} width={width} height={height} fill={overlay} />}
      </Svg>
    </View>
  );
}