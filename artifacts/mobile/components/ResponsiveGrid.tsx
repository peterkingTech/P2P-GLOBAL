import React from "react";
import { View } from "react-native";
import { TABLET_BREAKPOINT, useAdaptiveColumns } from "@/hooks/useLayout";
import { useWindowDimensions } from "react-native";

// Lays a list of cards out in as many columns as fit comfortably: the count
// comes from the grid's measured width and `minItemWidth`, so it adapts to
// portrait, landscape, Split View and Stage Manager. Below the tablet
// breakpoint it renders a Fragment — no extra native view — so the children
// stay direct children of the same parent and phone layouts (including any
// parent `gap`) are exactly as before.
export function ResponsiveGrid({
  minItemWidth,
  maxColumns = 3,
  gap = 12,
  rowGap = gap,
  children,
}: {
  minItemWidth: number;
  maxColumns?: number;
  gap?: number;
  rowGap?: number;
  children: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const { itemWidth, onLayout } = useAdaptiveColumns({ minItemWidth, maxColumns, gap });
  if (width < TABLET_BREAKPOINT) return <>{children}</>;
  return (
    <View onLayout={onLayout} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: gap, rowGap }}>
      {React.Children.map(children, (child) =>
        child == null || child === false ? null : <View style={{ width: itemWidth }}>{child}</View>
      )}
    </View>
  );
}
