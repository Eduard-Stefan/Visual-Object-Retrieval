export const number = (value: number) => new Intl.NumberFormat('en-US').format(value);
export const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
export const percent = (value: number) => `${Math.round(value * 100)}%`;
const colors = ['#6456e8', '#158a76', '#de7134', '#d5507d', '#3984cc', '#a257d0', '#8b7a28'];
export function categoryColor(name: string) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
