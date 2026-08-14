import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// clsx handles conditional class objects/arrays; twMerge then resolves
// conflicting Tailwind utilities (e.g. a caller passing `px-4` to override
// a component's own `px-3`) by keeping the last one instead of leaving both
// in the string, where Tailwind's own cascade order would decide (order it
// happens to generate the CSS in, not argument order) which one wins.
export function cx(...inputs) {
  return twMerge(clsx(inputs))
}
