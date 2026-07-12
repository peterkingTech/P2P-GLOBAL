import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

export function useColors(): AppColors {
  return useTheme().colors;
}
