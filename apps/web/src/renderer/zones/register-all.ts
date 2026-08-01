// renderer分割Phase 2b(uiplan §1-5 Phase2b③)。9ゾーンをside-effect importする
// だけのバレル — 各zones/*.tsxが末尾でregisterNode()を呼ぶことで登録が走る。
// renderer.tsxはこのファイルを1回importするだけでよい(依存の向きは
// renderer.tsx → register-all → zones → core の一方向DAG)。
import "./obs-batch";
import "./search";
import "./ind-profile";
import "./thread-posts";
import "./app-shell";
import "./knowledge";
import "./home";
import "./knowledge-chat";
import "./ind-screens/ind-detail";
import "./ind-screens/ind-match";
import "./ind-screens/pref-pairwise";
import "./ind-screens/ind-species";
import "./ind-screens/ind-cross";
import "./ind-screens/ind-bio-card";
