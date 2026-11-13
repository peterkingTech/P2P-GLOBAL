// esbuild's default "text" loader bundles a .txt import as its contents (a string) — used for the
// Biblical Dictionary search index (data/dictionary-index.txt), parsed only on first use.
declare module "*.txt" {
  const text: string;
  export default text;
}
