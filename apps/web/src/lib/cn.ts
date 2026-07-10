import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// ponytail: standard shadcn cn() — clsx + tailwind-merge, nothing more.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
