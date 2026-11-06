# 認可・テナント分離 設計案（レビュー指摘 M-1／M-5）

作成: 2026-11-06 / 状態: 設計案（要判断事項あり・未実装）
対象: `docs/REVIEW-RESPONSE.md` の M-1（サーバー側の認証・認可・公開範囲フィルタ）と M-5（school_id／学校・年度テーブル）
前提とする正本: `docs/DESIGN.md` v0.6（§2 原則3、§4 冒頭、§4.1、§9、§10）

---

## 0. 要点

- **M-5 を先にやり、M-1 はその上に載せる。** 権限は「誰が・どの学校で・何をできるか」なので、学校（テナント）の単位が先に決まっていないと定義できない。
- **テナント分離は「全業務テーブルに school_id を持たせる」方式を推す**（DESIGN §4 冒頭のとおり）。SQLite／libsql には行レベルセキュリティ（RLS）が無い。そこで、**学校で絞り込まない問い合わせを書けない DB 入口**（`tenantDb`）と、**学校をまたぐ参照を作れない複合外部キー**の2つで分離を守る。
- **認可はサーバーのアクション層で必ず判定する。** 48個のアクションすべてを、必要な権限を宣言する `secureAction` で包む。宣言のないアクションは登録できないようにする。
- **公開範囲の絞り込みはサーバーへ移す。** PR #1 で作った `client/src/audience.ts` の純粋関数を共有モジュールにして、`getRange`／`getBootstrap` が利用者の権限に応じて**返すデータそのもの**を絞る。クライアントから来る audience は信用しない。
- 未確定の前提が1つある：**本番の実行基盤が「ログイン中の利用者」をアクションに渡せるか**。試作の Hatch ランタイム（`ctx`）にその口があるかはコードからは分からない。§3.1 で、どちらの場合も成り立つ形にしてある。

---

## 1. 現状（このリポジトリのコードで確認した事実）

| 項目 | 現状 |
|---|---|
| 実行基盤 | `@hatch/space-sdk` の `defineAction`。DB は `ctx.db()`（drizzle + libsql／SQLite）。`ctx` に利用者の情報は渡っていない（`ctx.db` と `ctx.invalidateQueries` しか使われていない） |
| テナント | 無い。`settings` が `id=1` の1行だけの表で、学校名・年度（既定 2026）を持つ |
| 学校・年度テーブル | `schools`／`school_years`／`terms` は存在しない（DESIGN §4.1 にはある） |
| entitlement | `product_entitlements.school_name`（**学校名の文字列**）で学校を表している |
| 業務テーブル | 24個。どれも school_id を持たない |
| 利用者・権限 | 無い。アクションは全員が全件を読み書きできる |
| 公開範囲 | クライアント側だけ（`client/src/audience.ts`）。サーバーは全データを返す。当番パネルは絞り込み前のデータを直接受け取る（REVIEW-RESPONSE の申し送り） |
| 監査情報 | 誰が作成・変更したかを持たない（`duty_changes.requested_by`、`duty_conflict_waivers.waived_by` も無い） |

---

## 2. M-5：テナント分離

### 2.1 方式の比較

| 方式 | 中身 | 長所 | 短所 |
|---|---|---|---|
| **A. 行に school_id（推奨）** | 1つの DB。全業務テーブルに `school_id` を持たせる | DESIGN §4 と一致し、school-timetable と同じ方針。entitlement・連携・テンプレート共有のように学校をまたぐ処理が素直に書ける。実行基盤が DB を1つしか渡さなくても実現できる | WHERE の書き忘れが漏えいに直結する（RLS が無い）。§2.4 の仕組みで防ぐ必要がある |
| B. 学校ごとに DB を分ける | libsql の DB／ファイルを学校ごとに用意する | 書き忘れても他校のデータは物理的に見えない。学校単位のバックアップ・削除が容易 | 実行基盤が学校ごとに DB を開ける必要がある（試作の `ctx.db()` は1つだけ）。学校をまたぐ処理（entitlement、運営側の集計）に別の DB が要る。マイグレーションを学校の数だけ流すことになる |
| C. 併用 | 共通の DB（学校・利用者・契約）と学校ごとの業務 DB | 分離が強く、学校をまたぐ処理も書ける | 構成が最も複雑 |

**推奨は A。** 1校1年分のデータは小さく（予定・日次値・割当で数千〜数万行）、DB を分ける性能上の理由が無い。また DESIGN §10 の連携（school-timetable と school_id を共有する）は A を前提にしている。
ただし本番の実行基盤が学校ごとの DB を簡単に扱え、運営側の要件で物理分離が求められるなら、B を再検討する。判断事項 D-1 として §5 に挙げる。

### 2.2 追加するテーブル（DESIGN §4.1 準拠）

| テーブル | 主要カラム | 備考 |
|---|---|---|
| `schools` | id PK, name, school_type, prefecture, created_at | `settings` の学校名をここへ移す。連携モードでは school-timetable と同じ ID 体系にする（§10.3 の注意） |
| `school_settings` | school_id PK/FK, preset_applied, leave_types_json, link_mode, people_source, targets_source, periods_source | 現在の `settings` の残り。1校に1行 |
| `school_years` | id PK, school_id FK, year, starts_on, ends_on, term_system, is_current | `settings.school_year`（既定 2026）を置き換える。is_current は学校ごとに1行だけ（部分一意インデックス） |
| `terms` | id PK, school_id FK, school_year_id FK, name, starts_on, ends_on, sort | 長期休業の期間判定（当番の「長期休業のみ」）にも使える |

**年度は行に持たせない。** 予定・日次値・割当はすべて日付を持つので、どの年度かは日付と `school_years` から導ける。定義系（項目・当番・ビュー）は学校単位で年度をまたいで使う。年度ごとに変わるもの（輪番の顔ぶれなど）が出てきたら、そのとき有効期間の列を足す。

### 2.3 既存テーブルの変更

**全24テーブルに `school_id INTEGER NOT NULL` を追加する。** 子テーブル（`item_options`・`targets`・`period_definitions`・`rotation_members`・`event_assignees`・`event_targets`）にも持たせる。理由は2つある。

1. 子テーブルも直接問い合わせているため（例：`loadEvents` は `event_assignees` を全件取得している）。全テーブルに持たせれば「必ず school_id で絞る」を例外なしの規則にできる。
2. 親子が同じ学校であることを、複合外部キーで保証できる（§2.4②）。

一意制約は学校単位にする：

| 現在 | 変更後 |
|---|---|
| `day_records.date` UNIQUE | UNIQUE(school_id, date) |
| `item_definitions.key`（アプリ側で重複チェック） | UNIQUE(school_id, key) |
| `target_groups.key`、`period_patterns.code`、`view_definitions.name` など | UNIQUE(school_id, …) |
| `item_options` の code（PR #1 でアプリ側の差分キーにした） | UNIQUE(item_definition_id, code) |

`product_entitlements` は `school_name` を `school_id` に置き換える（学校名の変更で契約が外れる問題もなくなる）。`master_links` も学校単位にする。

### 2.4 書き忘れを防ぐ仕組み（A を選ぶ場合の必須条件）

RLS が無いので、**正しく書くのが簡単で、誤って書くのが難しい**形にする。

① **DB の入口を `tenantDb(auth)` に限定する**
- アクションのハンドラは `ctx.db()` を直接使わず、`secureAction`（§3.3）が渡す `tdb` だけを使う。
- `tdb.select(table)`／`tdb.update(table)`／`tdb.delete(table)` は `where school_id = auth.schoolId` を必ず付け、`tdb.insert(table)` は `school_id` を自動で埋める。drizzle のクエリビルダーを包む薄いラッパーにする。
- 学校をまたぐ処理（運営側の entitlement 管理など）だけが `ctx.db()` の生の DB を使う。その場所は `platformDb` という名前で区別し、使える場所をリントで限定する（例：`no-restricted-syntax` で `ctx.db(` の使用を `server/src/platform/` 以下に制限する）。

② **学校をまたぐ参照を作れないようにする**
- 親テーブルに UNIQUE(school_id, id) を張り、子から FOREIGN KEY (school_id, parent_id) REFERENCES parent(school_id, id) で参照する。こうすると、A校の予定がB校の場所 ID を指すような行は DB が受け付けない。
- ただし SQLite の外部キーは `PRAGMA foreign_keys=ON` が無いと効かず、試作の実行基盤でそれが有効かは不明（レビューの「確認できなかったこと」）。そこでアプリ側でも、**リクエストに含まれる ID がその学校のものか**を書き込み前に確認する（`assertOwned(tdb, table, ids)`）。対象は locationId、personId、targetIds、itemDefinitionId、dutyDefinitionId、assignmentId、viewDefinitionId など、引数で受け取るすべての参照 ID。

③ **テストで担保する**
- 分離テスト：A校とB校のデータを用意し、B校の利用者で全アクションを呼ぶ。そのうえで「A校の ID を指定した読み取り・更新・削除がすべて失敗する（または0件になる）」ことを確かめる。PR #1 の結合テストの仕組み（libsql の一時 DB＋マイグレーション）をそのまま使い、CI で常に回す。
- 静的チェック：`server/src/` 内で `ctx.db(` を `platform/` 以外が使っていないことを、リントかテストで検査する。

### 2.5 移行手順（SQLite／drizzle のマイグレーション）

試作データを持つ学校が1つある前提で、既存データをすべて `school_id = 1` に寄せる。

1. `0007`：`schools`・`school_settings`・`school_years`・`terms` を作成し、`settings` の1行から `schools(id=1)`・`school_settings`・`school_years(year=settings.school_year, is_current=1)` を作る。
2. `0008`：全業務テーブルに `school_id INTEGER NOT NULL DEFAULT 1` を ADD COLUMN する。SQLite の ADD COLUMN は既定値つきなら既存の行を書き換えずに済む。
3. `0009`：一意制約と複合外部キーの張り替え。SQLite は制約を ALTER できないので、**テーブルの作り直し**（新テーブル作成 → INSERT … SELECT → 旧テーブル削除 → 名前変更）になる。対象は、制約を変えるテーブルと複合外部キーを持たせるテーブル。`PRAGMA foreign_key_check` で整合を確認してから確定する。
4. `0010`：`product_entitlements.school_name` → `school_id`（学校名が一致する行は 1、それ以外は移行時に一覧を出して手で振り分ける）。
5. `DEFAULT 1` を外す（以後は `tenantDb` が必ず埋める）。これも作り直しが要るので、3 と同時に行ってよい。
6. 最後に `settings` テーブルを削除する。

アプリ側は、手順 2 の直後から `tenantDb` を使う形に切り替える。手順 1〜2 だけなら既存の動作は変わらないので、M-1 の前に単独でリリースできる。

---

## 3. M-1：認証・認可

### 3.1 利用者の識別（認証）

アクションに「誰が呼んだか」が届かないと、何も判定できない。届け方は実行基盤によって決まる。

| 経路 | 内容 | 採否 |
|---|---|---|
| 実行基盤のログイン | 基盤がログイン済みの利用者（ID・メール）を `ctx` に載せる | 本番の基盤にこの口があれば最優先で使う（要確認：D-2） |
| OIDC（Google／Microsoft） | 学校の Google Workspace／Microsoft 365 アカウントでログインする。GIGA スクールで教職員・児童生徒が学校のアカウントを持っている場合が多い | 基盤に口が無ければこれを推奨。DESIGN §10 の school-timetable との SSO も同じ ID 基盤に寄せる |
| 独自のメール＋パスワード | アプリ側でパスワードを管理する | 推奨しない（パスワード管理と再設定の責任を負うことになる） |

どの経路でも、アクション層が受け取るのは次の `AuthContext` だけにして、経路の違いは「アダプタ」1か所に閉じ込める。

```ts
type AuthContext = {
  userId: number;
  schoolId: number;      // この操作の対象校（複数校に所属する利用者は選んだ1校）
  role: Role;            // §3.2
  audienceRank: number;  // 0=職員, 1=保護者, 2=生徒, 3=公開
  personId: number | null; // 教職員なら people の行と結び付ける（「自分の出張」の判定用）
};
```

### 3.2 利用者・所属・役割

| テーブル | 主要カラム | 説明 |
|---|---|---|
| `users` | id PK, email, display_name, auth_provider, auth_subject, created_at | 学校をまたいで1人1行。UNIQUE(auth_provider, auth_subject) |
| `memberships` | id PK, school_id FK, user_id FK, role, person_id FK nullable, status（active/invited/suspended）, created_at | 学校への所属。UNIQUE(school_id, user_id)。教職員は person_id で `people` と結ぶ |
| `invitations` | id PK, school_id FK, email, role, token_hash, expires_at, accepted_at | 管理者による招待。トークンはハッシュだけを保存する |

**役割**（DESIGN §9「管理者／行事担当／一般教職員」＋閲覧者）：

| role | audienceRank | できること |
|---|---|---|
| `admin` 管理者 | 0 | すべて。定義（項目・対象軸・当番定義・日課・ビュー）、マスタ、プリセット、テンプレート取込、連携設定、所属・招待の管理、発行 |
| `editor` 行事担当 | 0 | 予定・日次値・日レコード・当番割当・交代・見送り・輪番適用・CSV 取込・発行・印刷 |
| `staff` 一般教職員 | 0 | 職員用の閲覧。**自分が担当者になっている** 出張・研修・休暇の作成と編集。自分の当番の交代の申し出（R-4 の status=proposed） |
| `guardian` 保護者 | 1 | audience=guardian 以上のビューの閲覧だけ |
| `student` 児童生徒 | 2 | audience=student 以上のビューの閲覧だけ |
| （ログインなし） | 3 | **公開を明示したビュー・発行版だけ**。§3.6 |

権限の細かさ（例：「当番担当」を別の役割にするか）は学校によって違いうる。最初は上の5つで固定して、要望が出たら role を権限の束（`role_permissions`）に分解する。判断事項 D-4。

### 3.3 アクション層での強制

- `defineAction` を直接使わず、必要な権限を宣言する `secureAction` で包む。

```ts
secureAction({
  permission: "event.write",          // §3.4 の表のどれか。"public" も明示の宣言として扱う
  request, response,
  async handler({ auth, tdb, ctx }, args) { ... },
});
```

- `secureAction` の処理は、①アダプタから `AuthContext` を得る（得られなければ 401）、②`permission` を role と照合する（足りなければ 403）、③`tenantDb(auth)` を作る、④ハンドラを呼ぶ、の順。PR #1 の `inTransaction` も `tdb` を受け取る形に揃える。
- `Actions` の型を `Record<string, SecureAction>` にして、**`secureAction` を通っていないアクションは型エラーになる**ようにする。宣言の付け忘れをコンパイル時に防ぐ。
- 「自分の予定だけ」のような行単位の判定は、ハンドラ内で `canEditEvent(auth, event)` のような純粋関数で行い、単体テストを付ける。

### 3.4 アクションと必要な権限（現行の 48 アクション）

| 権限 | 対象アクション | admin | editor | staff | guardian／student |
|---|---|---|---|---|---|
| `view.read` | getBootstrap, getRange, getSummary | ○ | ○ | ○ | ○（§3.5 で絞り込み） |
| `event.write` | createEvent, updateEvent, deleteEvent, moveEvent | ○ | ○ | △自分の出張・研修・休暇だけ | － |
| `daily.write` | setDailyValue, moveDailyValues, setDayRecord | ○ | ○ | － | － |
| `duty.write` | setDutyAssignment, previewRotation, applyRotation, applyDutyChange, waiveConflict | ○ | ○ | △自分の割当の交代申し出だけ | － |
| `import.events` | importEvents | ○ | ○ | － | － |
| `publish` | createPublication, updatePublication, deletePublication | ○ | ○ | － | － |
| `view.layout` | setViewColumnWidths | ○ | ○ | ○（ビューの共有設定を変えるので要検討：個人ごとの幅にする案もある） | － |
| `definition.write` | upsert/delete の ItemDefinition, TargetGroup, Target, PeriodPattern, DutyDefinition, View | ○ | － | － | － |
| `master.write` | upsert/delete の Person, Location, Holiday | ○ | ○（祝日・場所は可、人は admin のみも選べる） | － | － |
| `school.admin` | saveSettings, saveLeaveTypes, applyPreset, exportTemplate, importTemplate, saveLinkSettings, upsert/deleteMasterLink | ○ | － | － | － |
| `platform.admin` | upsertEntitlement, deleteEntitlement | 運営側だけ（学校の admin でも不可。契約は課金境界なので学校には変えさせない） | － | － | － |

追加するもの：所属・招待の管理アクション（`school.admin`）、利用者が所属校を選ぶアクション。

### 3.5 公開範囲のサーバー側フィルタ（M-1 の中心）

**実効ランク**＝`max(利用者の audienceRank, 表示するビューの audience のランク)`。教職員が生徒用ビューで「生徒にどう見えるか」を確かめるのは自由だが、生徒が職員用ビューを指定しても職員のランクにはならない。

- `getRange({ from, to, viewId })`：`viewId` を受け取り、サーバー側で実効ランクを計算する。`client/src/audience.ts` の `audienceColumns`／`audienceItems`／`filterRangeForAudience` を `shared/audience.ts` に移し、サーバーとクライアントの両方から使う。職員以外には予定（visibility）、許可された項目の日次値、空の当番・競合・交代履歴だけを返す。
- `getBootstrap`：職員以外には、ビュー（自分のランクで見られるものだけ）、ビューに出る項目定義、対象軸、祝日、学校名だけを返す。人の一覧、当番定義と輪番、場所、名寄せ、entitlement、発行履歴、テンプレート関係は返さない。
- 予定の担当者名：職員以外には既定で返さない（DESIGN §9「個人情報を含む項目は既定で閉じる側」）。保護者向け行事で引率教員名を見せたい学校があれば、ビューの設定で明示的に開ける。
- **休暇の分類（leave_type）は職員にも絞る。** 「病休」「看護」などは健康情報や家庭事情にあたる。admin と取得者本人以外の職員には「休暇」とだけ返し、分類は返さない（判断事項 D-5）。
- これでレビュー後の申し送りにあった当番パネルの未フィルタ経路も塞がる（職員以外にはそもそも当番データが届かない）。クライアントでは、パネルとヘッダーの競合バッジを `role ∈ {admin, editor, staff}` のときだけ出す。
- クライアント側の `audience.ts` による絞り込みは残す（表示の整合のため）。ただし、**守りはサーバー側の絞り込みだけが担う**とコメントで明記する。

### 3.6 ログインしない閲覧（保護者・地域）

DESIGN §9 の「URL を知っていること自体を権限にしない」と、§9.1 の「アカウントを持たない保護者へは PDF で渡す」を両立させる。

- 既定：保護者・生徒もログインして閲覧する（学校アカウントか招待）。
- アカウントを配れない学校向け：**発行版（publications）のスナップショット**を配布手段にする。R-5（発行版に中身を持たせる）と一体で、発行時点の内容を固定した PDF／静的ページを作る。共有リンクを使う場合は、推測できない長いトークン・有効期限・失効操作を付け、audience=public か guardian の発行版だけに限る。生きたデータ（getRange）は匿名には一切開けない。

### 3.7 監査・記録（R-1(e)／R-4 の受け皿）

- `events`・`daily_values`・`duty_assignments`：`created_by`、`updated_by`、`updated_at`（user_id）。
- `duty_changes`：`requested_by`、`approved_by`。from／to は person_id で持ち、`status`（proposed/applied/declined）を実際に使う（R-4）。
- `duty_conflict_waivers`：`waived_by`（R-1(e)）。
- 所属・役割の変更、招待、テンプレート取込、プリセット適用は `audit_log`（school_id, user_id, action, target, at, summary）に残す。

### 3.8 通信面

- セッションの持ち方は実行基盤に合わせる。Cookie を使う場合は `HttpOnly; Secure; SameSite=Lax` にし、アクション（POST）には CSRF 対策をする（Origin ヘッダーの検査かトークン）。
- 401／403 はクライアントで区別して扱う（401 はログイン画面へ、403 は「権限がありません」と表示）。現在のエラー表示（設定画面下のトーストなど）をそのまま使える。

---

## 4. 実施順序

各段階が単独でリリースでき、途中でも既存の動作を壊さない順にしてある。

| 段階 | 内容 | 完了条件 |
|---|---|---|
| 1 | M-5 前半：§2.5 の手順 1〜2（学校・年度テーブル、school_id 列を既定値 1 で追加）。`tenantDb` を導入し、全アクションをそれに切り替える（学校は 1 で固定） | 既存の結合テストが通る。`ctx.db(` が platform 以外に残っていない |
| 2 | M-5 後半：一意制約・複合外部キーの張り替え（手順 3〜6）。`assertOwned` を追加する | 2校分のデータで分離テストが全アクションで通る |
| 3 | M-1 前半：認証アダプタ、`users`／`memberships`／`invitations`、`secureAction` と権限表（§3.4） | 未ログインは 401、権限不足は 403 になる。権限表どおりであることを全アクション×全役割のテストで確かめる |
| 4 | M-1 後半：サーバー側の公開範囲フィルタ（§3.5）、`shared/audience.ts` への移動、bootstrap の削減、当番パネルのゲート | 生徒・保護者の利用者で API を直接呼んでも、職員のみの予定・日次値・当番・人名が返らない |
| 5 | 監査列（§3.7）、匿名配布（§3.6、R-5 と一体） | — |

段階 1・2 はデータの移行を伴うので、試作データのバックアップを取ってから行う。

---

## 5. 判断事項（荒木の判断が必要）

| # | 判断事項 | 推奨 |
|---|---|---|
| D-1 | テナント分離の方式（§2.1：行に school_id／学校ごとに DB） | 行に school_id（A） |
| D-2 | 本番の実行基盤と、利用者の識別をどこに任せるか（§3.1） | 基盤のログインがあればそれを使う。無ければ Google／Microsoft の OIDC |
| D-3 | 保護者・生徒にアカウントを持たせるか、発行版の配布にするか（§3.6） | 学校が選べるようにする。既定はログインして閲覧、アカウントを配れない学校は発行版の配布 |
| D-4 | 役割は固定の5種でよいか（§3.2） | まず固定。細かい権限は要望が出てから |
| D-5 | 休暇の分類を職員の間でも伏せるか（§3.5） | 伏せる（admin と本人だけに見せる） |
| D-6 | 一般教職員に「自分の出張・休暇」の入力を許すか（§3.4 の △） | 許す（転記の手間を減らせる）。ただし承認ワークフローは非目的（DESIGN §1.4）なので作らない |
| D-7 | school-timetable 側の利用者・学校 ID の作りに合わせる必要があるか | 要確認。school-timetable のリポジトリをこのセッションから参照できなかったため、本案は DESIGN.md の記述（「school-timetable と同方針」）だけを根拠にしている |

---

## 6. この案で解消する／しないレビュー指摘

- 解消：M-1、M-5、R-1(e) の waived_by、R-4 の requested_by／status（列の受け皿）、N-3（年度のハードコード）、REVIEW-RESPONSE の申し送り（当番パネルの未フィルタ経路）。
- 一部：R-5（匿名配布の仕組みは本案、スナップショットの中身は R-5 側で決める）。
- 対象外：R-1(a)、R-6、R-7、N-2、N-4（スキーマ設計の別の論点。ただし段階 2 でテーブルを作り直すので、R-6／R-7／N-4 のスキーマ変更を同じ作り直しに相乗りさせると移行が1回で済む）。
