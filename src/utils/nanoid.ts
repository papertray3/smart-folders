// Lightweight ID generator to avoid pulling the full nanoid package.
const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

export function nanoid(size = 10): string {
  let id = "";
  for (let i = 0; i < size; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}
