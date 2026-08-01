// 3d-force-graph(package.json:19)にバンドル型定義が無い(vendor版public/finder/lib/
// も無型で使われてきた=既存踏襲)。GraphView.tsx はWebGL初期化をtry/catchで包み
// honest fallbackに倒す設計のため、詳細なメソッドチェーン型は要らない(any一発)。
declare module "3d-force-graph" {
  const ForceGraph3D: (...args: unknown[]) => any;
  export default ForceGraph3D;
}
