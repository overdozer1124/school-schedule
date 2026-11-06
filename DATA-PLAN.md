# Data Plan

## Context provenance
- `独立で連携可能としてください。理由は行事予定しか使わない学校もあれば、時間割しか使わない学校、そして両方使う学校とパターンが考えられます` (prior user statement; 単独モードで完結する設計にし、連携は将来のID参照として境界だけ残す)
- `入力は基本的に予定を直接行事予定表のセルに文字入力。その入力した文字がオブジェクト化し、そのオブジェクト化した文字からモーダルが表示され詳細編集が可能な作りにしたい` (prior user statement; セル直接入力→Enter確定→詳細モーダルの状態遷移を Phase 1 の主経路にする)
- `時間はAndroidアプリなどでよくあるアナログ時計盤で時と分を選択するタイプで直接文字入力も可能。場所は登録されている場所があればリスト表示され、直接入力も可能。担当者はあらかじめ登録されている人をリストから選択、複数選択可能、直接入力可能` (prior user statement; 詳細モーダルの入力部品仕様としてそのまま実装)
- `交代が発生する可能性は怏々にしたるので、そこは重要です。また、出張と日番が重なった場合に交代を促すような仕組みも必要です` (prior user statement; 交換/代行を履歴付きの正式操作にし、出張・休暇・研修との競合検出と候補提示を必須機能にする)
- `推奨：PDF／印刷を正式出力にする` (user-accepted assistant proposal; 月表はビュー定義から印刷用レイアウトを生成し、発行版と紐付ける)
- `この5スタイルでPhase 1の試作に進んで` (prior user statement; L1〜L5 全種を同一データで切り替える試作範囲。DESIGN.md v0.6 §12 の試作範囲定義と一致)
- `汎用DB設計書 v0.6` at ~/workspace/school-event-schedule-app/DESIGN.md (handed-off design document; テーブル設計・項目定義/対象軸/当番定義の定義駆動モデル・§4.8.1 レイアウトカタログ・§5.1 プリセット・§5.2 受け入れシナリオの出典)
- `全学年同じなら1～6年　14:30～14:40のように省略したりできるといい` (user statement 2026-11-05; 対象グループ項目のセル表示は保存値から導出する省略表示とする — 全対象が同値なら範囲ラベルで1行にまとめ、連続する同値も範囲化し、異なる値は対象ごとに全て表示。保存データは対象ごとの daily_values のまま変えない。編集時は範囲一括入力を既定とし、「学年別」で個別編集に展開できる)
- `入力後に詳細画面が出るのではなく、小さなリストが入力した予定の横に表示され、そこに担当者のリスト、確定後に場所のリスト、確定後に時間の選択画面といった形で入力をサポートする` (user statement 2026-11-05; セルで件名を確定した直後は詳細モーダルを開かず、入力セルの横にステップ式クイック入力カード（1.担当者リスト→2.場所リスト→3.時間選択）を表示する。各ステップはスキップ可能で、確定のたびに updateEvent で即保存する。詳細モーダルは従来どおり残し、カード内の「詳細編集を開く」や予定チップのタップから開ける)
- `このモーダルが開いた時に、担当者を入力する画面が出ますが、自動的に担当者の入力欄にフォーカスされるようになると、クリックを挟まなくてもそのままキーボードで入力できると思います。また、1.担当者、2.場所、3.時間と言うところをクリックするとその項目の入力画面になるといいと思います。あと、入力後はエンターキーで確定して次へ進めるようにしたいです。担当者はエンターキーで次の担当を追加になりますが、ctrl+enterで追加にしてください` (user statement 2026-11-06; クイック入力カードのキーボード操作仕様 — 開いた直後とステップ移動時にそのステップの入力欄へ自動フォーカス。ステップ見出しはクリックでそのステップへジャンプ。Enterは「確定して次へ」（最終ステップは完了）。担当者の直接入力では Ctrl+Enter が担当者の追加で、通常の Enter は入力中の氏名も担当者として取り込んで次へ進む。IME変換中の Enter は対象外)
- `セル内の上部をクリックしないと入力状態になりません。セルクリックで入力状態にしてください` (user statement 2026-11-06; 表のセルは全面が入力ターゲット — セル内のどこをクリックしても、そのセルの最初の編集フィールド（入力欄・選択欄）へフォーカスが移る。フィールド自体やボタンへのクリックは従来どおり。L1〜L3 の行表と L5 の終日帯に適用)
- `休暇予定を入力したとき、場所が出ましたが、休暇の場合は休暇分類の選択にして欲しいです。年休や特休などです` (user statement 2026-11-06; 種別「休暇」の予定では場所は無意味なため、クイック入力のステップ2と詳細モーダルの場所欄を休暇分類の選択に切り替える。分類は events.leave_type に保存し、候補は年休・特休・病休・介護休暇・育児休業・その他＋直接入力。表のチップと日の詳細にも分類を表示する)
- `あと、モーダルが開いた時にモーダル以外をクリックしたらモーダルが消えるようにしてください` (user statement 2026-11-06; クイック入力カードと詳細編集モーダルの両方で、外側（背景・表側）のクリックで閉じる。閉じる際の保存扱いは従来どおり — カードは確定済みステップを保持し予定オブジェクトは消えない、詳細モーダルは「閉じる」ボタンと同じ扱い。外側判定はカード／モーダルの要素外に限定し、パネル内（時計盤含む）のクリックでは閉じない)
- `休暇の項目についてですが、リストの内容の編集は設定でできるようにし、項目は年休、病休、特休、夏特、看護、職専免、振休、その他にしてください` (user statement 2026-11-06; 休暇分類リストは settings.leave_types_json に JSON 配列で保存し、設定画面で追加・編集・削除・並べ替え・初期値復元ができる。初期値は指定の8項目（年休・病休・特休・夏特・看護・職専免・振休・その他）で、この順序が表示順。クイック入力と詳細モーダルは bootstrap.settings.leaveTypes を参照し、直接入力も従来どおり可。既存予定の leave_type は自由文字列のまま保持され、リストから外しても表示は変わらない)
- `休暇予定に関して、表示されるのは件名ではなく担当者名になると思います。担当者という言い方はおかしいですが、休暇取得者を表示させたいのですが、現在の作りは共通の詳細画面になっており、そのため目的に応じた入力用のモーダルにする必要があると思います` (user statement 2026-11-06; 休暇予定の表示見出しは件名ではなく休暇取得者名（担当者として登録された人）とする — lib.eventHeadline が全レイアウトのチップ・日の詳細・タイムライン・未定リスト（印刷含む）で休暇のみ取得者名を返し、未設定時は件名にフォールバック。入力UIは種別で分岐：クイック入力カードのステップ1と詳細モーダルの担当者欄は休暇では「休暇取得者」と呼び、役割の既定値も「取得者」にする。詳細モーダルは休暇専用構成（見出し「休暇の詳細／休暇を追加」、件名欄なし＝保存時に件名は取得者名から導出、取得者と休暇分類を上部に配置、対象欄は出さない）。休暇以外の種別は従来の共通フォームのまま)
- `予定表に入力された内容をドラッグアンドドロップで違う日に移動できるようにしてください` (user statement 2026-11-06; 入力済みの内容はドラッグ＆ドロップで別の日へ移動できる — 予定チップ（L1〜L5全レイアウト＋未定リスト）を掴んで別の日のセルへ放すと moveEvent で日付が変わる。単日予定はその日へ、期間予定は掴んだ日からの移動量で全体がずれ長さは保持、月のみ確定／時期未定は放した日に日確定として割り当てる。別種別の列へ放した場合は種別もその列に変わる。時刻・担当者など日付以外の内容は保持。日次項目（下校時刻など）はセルの「⠿」ハンドルを同じ項目の別日のセルへドラッグすると moveDailyValues でその項目の全対象分が移動し、移動先の同項目・同対象は置き換わる。マウスはHTML5ドラッグ、タッチ／ペンはポインタイ追従ゴースト＋閾値超えで開始するポインタドラッグで、単なるクリック（詳細を開く／セルにフォーカス）は従来どおり。印刷（readOnly）ではドラッグ無効)
- `では、phase2の実装を進めてください` (user statement 2026-11-06; Phase 2 の範囲は DESIGN.md v0.6 §12 の確定分に従う — 5スタイルとドラッグ移動は試作に先行実装済みのため、残りを実施：①転置表（layout=transposed、対象を行・日を列にし、対象に割り当てられた予定も併記。プリセットは学年別下校の転置表と中学校の部活動予定表を用意）②生徒用ビュー（audience=student のビューを用意し、職員以外ビューでは予定を visibility の到達範囲で絞る＝職員のみの予定は保護者・生徒ビューに出ない。項目列・当番列の絞り込みは従来どおり。プリセットの家族向け項目（給食・下校・バス・部活動・最終下校）の公開範囲は「生徒可」にして生徒用月表でも列が出るようにした）③集計（getSummary が表示期間について日種別ごとの日数と、集計可能項目の「数える」記号の日数を対象別内訳つきで導出。保存はしない導出値。授業日数は日レコード優先、無ければ土日・登録祝日を休業日として数える）④版管理・公開履歴の拡充（発行記録にメモを付けられるようにし、設定の発行履歴で版ラベル・メモの編集と削除ができる。印刷プレビューにはその期間の発行履歴を表示）⑤印刷対応の拡張（印刷は現在のレイアウトに従う：L2週表は表示中の週・2週、L3年間表、L4カレンダー格子、転置表も印刷でき、印刷側でも対象者フィルタを画面と同じに適用。L5タイムラインは従来どおり画面専用）)

## Tested sources
No external data sources. All content is user-entered at runtime (予定・当番・マスタ). No web fetch, no external API, no build-time imagery.
Imagery not needed: this is a data-entry schedule grid; the design has no visual subjects and photos would not serve the ledger workflow.

## Long-term data behavior
- **Refresh policy**: none; no external records to refresh. Data changes only through the user's own edits in the artifact.
- **Growth**: events, daily values, duty assignments/changes accumulate per school year; range queries are bounded by the visible period (month / 2 weeks / school year Apr–Mar for L3).
- **Ordering**: dates ascending; within a day, all-day first then start time then creation order. Duty changes and publications newest first.
- **Time semantics**: all dates are school-local calendar dates stored as YYYY-MM-DD text (Asia/Tokyo context); times are wall-clock HH:MM text. Weekday is always derived from the date, never stored. School year runs April–March.
- **Initial state**: starts empty (no invented events, people, or duties). Definition presets （小学校バスなし／小学校バスあり／中学校） are applied only when the user explicitly taps a preset button in settings; presets create definitions and masters scaffolding, never schedule history.

## Rejected approaches
- **Tried**: fixed-column schema (date, event, lunch, bus, dismissal…)
  **Why rejected**: the 25-school survey in DESIGN.md §1.2 shows only date+free-text are universal; fixed columns cannot express schools without buses or with AM/PM duties. Definition-driven item/duty/target model adopted instead.
- **Tried**: form-first event entry on a separate screen
  **Why rejected**: user decision ② makes cell direct input the primary path; forms exist only as the post-Enter detail modal.
- **Tried**: storing conflicts as rows
  **Why rejected**: DESIGN.md §4.7.2 — conflicts are derived from assignments × absence events at read time; only waivers are stored, so a conflict disappears naturally when the event is removed.
