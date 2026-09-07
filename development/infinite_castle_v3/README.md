# 無限城 Prototype v0.1.36

Minecraft Bedrock 1.26.40 / `@minecraft/server 2.9.0` 向けの独立パックです。
既存のピネン統合BP/RPと竜の遺物には変更を加えません。

## v0.1の構成

- `dimensionSetup.js`: voidの専用ディメンション `infinite_castle:dungeon` を登録
- `topologyDungeonGenerator.js`: 5x5x4グリッド上に、全接続の30室と少量のloopを先に生成
- `roomRegistry.js`: 21テンプレートと6方向の標準socket/localPosition
- `roomSeed.js`: 城seedから部屋固有seedを導出し、旧セーブを新形式へ移行
- `dungeonGraph.js`: Roomをnode、接続をedgeとして保持・保存
- `reconstructionManager.js`: プレイヤー室+直結隣室をLOCKし、非LOCKのbridgeで保護島を再接続
- `japaneseRoomBuilder.js`: 畳割り、柱梁、白壁、障子、格天井、行灯、床の間、鳥居風出口を描画
- `japaneseCastlePieces.js`: 書院造・天守内部を参考にした再利用可能な複合建築部品
- `roomTemplateArchitecture.js`: 21テンプレートそれぞれの固有平面・断面・内部骨格
- `connectionIntegrity.js`: 論理edgeに対応する水平通路・上下足場の実ブロック監査
- `chunkLoading.js`: Script APIのTickingAreaManagerによる各部屋チャンクの先読みとロード完了待機
- `infiniteCastleManager.js`: 入退場、永続化、再構築、デバッグ操作を統合
- `entranceTransition.js`: 琵琶・足元の障子開閉・俯瞰カメラ・転送を安全な短いタイムラインで制御

通常再構築ではプレイヤーに近い非LOCKセルから順に、旧室を上層から2ブロックずつ分解し、
床・軸組・壁・固有建築・connectorの順に新室を組み上げます。処理中もプレイヤー位置を再確認し、
現在セルと周囲1セルへ移動した場合はそのセルの変形を中止します。

旧 `dungeonGenerator.js` と `placeholderStructures.js` は比較・ロールバック用に残していますが、
実行経路からは外れています。

## 入口

`infinite_castle:entrance_marker` の上を通過すると入場します。
監視対象は `pinene_pvp:pvp_island`、Overworld、Nether、The Endです。
入口からは帰還できず、出口カテゴリの部屋へ入ると入場前の場所へ戻ります。
帰還地点はPlayer Dynamic Propertyにも保存されるため、スクリプト再読み込み後も復元できます。

入場時は参考映像の流れを約0.8秒へ圧縮し、琴の一音とともに足元へ障子床を表示します。
斜め上のカメラから障子戸が約0.5秒で左右へ開いて暗い開口が現れる様子を見せ、最後の一瞬だけ暗転して
無限城へ転送します。カメラ・パーティクル演出に失敗した端末でも転送処理は独立して継続します。
琴音は提供されたノイズ除去版A/Bの2音から再生ごとに等確率で1つ選ばれ、入場・帰還・城再構築で共通利用します。
時間・転送時の短い暗転・俯瞰位置は
`config.js` の `ENTRANCE_TRANSITION` から調整できます。

## 部屋seedと破損状態

全RoomInstanceは `roomSeed` と `revision` を保存します。同じRoomInstanceを修復すると、
畳模様・行灯位置・床の間位置・装飾配置まで同じ結果に戻ります。旧版の保存データは
読み込み時に城seedと部屋情報からroomSeedを決定的に補完し、自動的に新形式へ移行します。

通常再構築では仕様どおり、プレイヤーの現在室と直結隣室をブロック破損状態ごとLOCKします。
そのためLOCK中の部屋は自動修復されません。修復操作は必ず城内を無人にして実行します。

## 和風城郭Prototype

単純な畳部屋だけでなく、カテゴリごとに次の部品を組み合わせます。

- 客間・宝箱部屋: 上段の間、床の間、違い棚、付書院、彫刻欄間風の建具、折上格天井
- 廊下・戦闘部屋: 天守の側廻りを意識した武者走り、武具掛、長押
- 階段部屋: 太い通し柱、二段の踊り場、中央安全シャフト
- 吹き抜け: 中央を見下ろす二層回廊、四隅の通し柱
- 入口・出口: 唐門・櫓門を抽象化した重層梁と飾金具

中央の水平socket動線と5x5の縦シャフトは装飾工程の最後に開通させるため、
複雑な建築部品が攻略経路を塞がない構造です。実在建築をそのまま複製するのではなく、
姫路城天守の軸組・側廻りと、二条城二の丸御殿の書院造意匠を24x24x16セルへ抽象化しています。

renderer版はWorld Dynamic Propertyへ保存します。保存済みの城が旧rendererの場合、
城内が無人になった時点でrenderer v9による全室更新を一度だけ自動実行します。

### 空中回廊

廊下カテゴリーは24x24の密閉された部屋ではなく、DungeonGraph上の実connectorに沿って伸びる幅3ブロックの空中回廊として描画します。外周は低い木柵と間隔を空けた和風の門型フレームだけにし、天井と外壁を大きく開放しています。曲がり・分岐型には小さな見晴らし台が付き、周囲の部屋や再構築中の変化を回廊上から見渡せます。論理セルサイズとLOCK判定は従来の24x24x16のままです。
更新中は入口からの入場を保留し、完了後に再入場できるようにします。

## 設定

`scripts/infinite_castle/config.js` で次を変更できます。

- 部屋カテゴリ重み
- 深層入口確率（通常0.5%、デバッグ時は1.0で100%）
- 再構築間隔（30〜60分）
- loop本数
- 枝道の横倒し・逆さ割合
- 入口監視ディメンションと帰還fallback
- 入場演出の障子パーティクル、琴音、俯瞰カメラ位置、転送時の短い暗転

## 実機確認コマンド

素材元ワールドから抽出した6建築を、実行者の前方へ64ブロック間隔の2x3で並べて確認:

```mcfunction
/scriptevent infinite_castle:preview_source_parts
```

各建築の配置座標と寸法がチャットへ表示されます。十分に空いた場所で実行してください。

素材建築の看板名と実ブロックを解析し、接続socketを「通常重力で歩けるオーク材の経路」から
生成します。交差廊下と渡り廊下はY軸回転だけを使い、本線である足位置Y=28・幅11の
`oak_planks` 床から中央幅5を接続口にします。部屋は下層オーク床の直前にあるスプルース丸太の
敷居へ接続し、使用時だけ中央幅5・3ブロック高＋アーチ天端を開口します。

収録済み21姿勢すべてについて、足元支持・3ブロックの頭上空間・1ブロック昇降・入口間の
連結性・経路幅を通常のワールドY軸で再検査します。15姿勢だけを採用し、オーク床が壁や天井に
なってしまう部屋2姿勢と階段4姿勢は候補から除外します。元の床法線がdown/north/east/southでも、
回転後に幅5以上の連続した昇降路になる階段姿勢は攻略可能部品として採用します。

検証済み姿勢だけから、12棟すべてが相互探索可能な計画を作って再構築テスト:

```mcfunction
/scriptevent infinite_castle:rebuild_source_parts
```

実行者の東128ブロック付近に構築します。同じワールドで再実行すると、次の12棟計画を
最大128回まで先に完成・検証し、成功後だけ前回のテスト配置を消去して組み直します。
12棟を満たせない候補を少数配置へ縮退させることはありません。

接続はsocket中心間へ汎用床を張る方式ではなく、両建築の実際の歩行レーンを1ブロック隣へ
直接合わせます。橋と階段は抽出済みの最小建築単位を繰り返し部品として利用し、接続用の
ダークオーク床は生成しません。12棟は1つの探索グラフとして11本のsocket接続で結び、
景観専用の孤立棟は作りません。使用する部屋接続口だけ壁・柵をアーチ状に開口します。
建材と実歩行経路の頭上空間を1ブロック単位で衝突判定します。
接続レーンと開口座標も高さ範囲へ含め、構成全体を同じY量だけ自動補正します。
偶数サイズの建築を90度回転するときも、ブロック中心 `(size - 1) / 2` を基準にsocketを
変換するため、回転姿勢による1ブロックの軸ずれは発生しません。

現在ゲームが読み込んでいるスクリプト版を確認:

```mcfunction
/scriptevent infinite_castle:debug_build_version
```

新しい版なら `build=0.1.19-oak-navigation renderer=9` と表示されます。
何も表示されない場合は旧スクリプトがまだ実行中なので、ワールドを完全に閉じて開き直します。

直近の全室建築で、実際に成功・失敗した部屋数と先頭5件のエラーを確認:

```mcfunction
/scriptevent infinite_castle:debug_build_report
```

全室成功した場合だけrenderer版を更新済みとして保存します。1室でも失敗した場合は
旧外観のまま更新済みになることを防ぎ、1分以上の間隔を空けて再試行します。

プロジェクト本来の体験・建築LEGO方式・現在との差は `DESIGN_INTENT.md` に固定しています。

Claude版などの旧配置から、接続保証付きの新しい30室グラフと和風建築へ移行する場合は、
城内を無人にしてピネディメンション側から一度だけ実行します。新グラフの検証が成功してから
旧管理対象の部屋を消し、複数tickに分けて建て直します。

```mcfunction
/scriptevent infinite_castle:debug_regenerate_v01
```

現在のグラフは変えず、外観だけを新しい和風レンダラーで建て直す場合:

```mcfunction
/scriptevent infinite_castle:debug_refresh_visuals
```

全30室を保存済みのroomSeedどおりに修復する運用コマンド:

```mcfunction
/scriptevent infinite_castle:repair_all
```

旧版の破損・未追跡ブロックも含めて5x5x4の全100セルを消去し、新しいcastleSeedから
30部屋を完全新規生成する場合（必ず城内を無人にして実行）:

```mcfunction
/scriptevent infinite_castle:rebuild_from_scratch
```

現在のcastleSeedと部屋ごとのroomSeed/revisionは6件ずつ確認できます。ページは1〜5です。

```mcfunction
/scriptevent infinite_castle:room_seeds 1
```

全30部屋の実ブロック上のconnectorを検査し、塞がった水平通路・上下足場だけを局所修復:

```mcfunction
/scriptevent infinite_castle:audit_connections
```

監査結果の再表示:

```mcfunction
/scriptevent infinite_castle:debug_connection_report
```

指定した1室だけを修復する場合はグリッドセル座標を渡します。

```mcfunction
/scriptevent infinite_castle:repair_room 2 0 3
```

現在位置のセル座標・roomSeed・revisionは次で確認できます。

```mcfunction
/scriptevent infinite_castle:debug_room_info
```

出口だけを直接検証:

```mcfunction
/scriptevent infinite_castle:debug_force_exit
```

監視状態:

```mcfunction
/scriptevent infinite_castle:debug_tick_count
/scriptevent infinite_castle:debug_room_info
/scriptevent infinite_castle:debug_list_exits
/scriptevent infinite_castle:debug_reconstruction_status
```

再構築:

```mcfunction
/scriptevent infinite_castle:force_reconstruct
```

`debug_reset_dungeon` は保存グラフだけを消し、配置済みブロックは消さない低レベルの開発用操作です。
通常は使用せず、旧版からの移行には `debug_regenerate_v01`、外観だけの更新には
`debug_refresh_visuals` を使用してください。

## 自動検証

`tests/infiniteCastle.logic.test.js` は5,000 seedについて、30室・全接続・出口2室・最低距離・
socketの相互整合を検証します。さらに500ケースでLOCK室の保持と再接続を検証します。

## 素材建築・三層メイン城 v0.1.30

- 高速な動的再構築の保護区画引数がずれて失敗する問題を修正した。
- `/scriptevent infinite_castle:force_reconstruct <seed>` で、障害復旧時に同じ再構築計画を再実行できる。
- 接続口は境界だけでなく、両建物の内側3ブロックまで幅どおり・高さ3ブロックを最終開通する。行き止まり封鎖より接続口の開通を後に行うため、使用中の出入口が封鎖されない。
- 再構築中に通常速度で隣室へ移動できるよう、滞在区画から接続2段先までを維持する。
- 現在の城を再配置せず出入口だけ直す場合は、無限城内で `/scriptevent infinite_castle:repair_openings` を実行する。

素材元から検証済みの構造だけを使い、34パーツを下層・中層・上層へ再構築します。
内訳は部屋15、交差廊下6、橋5、階段8です。各層に周回路があり、層間には2経路ずつあります。
接合は実構造の幅5 socket同士を直接合わせ、汎用の暗色床材では延長しません。
使わない交差廊下口はオーク柵の見晴らし端として閉じます。

同じseedで積層寄りの `castle` と、同方向へずれる `floating` を比較できます。
階段は既定で `smooth`、元構造の段差へ戻す場合は `authored` を指定します。

遠隔配置は10 tick間隔で直列化し、加工前に全階段セル・全socket支持床・各サブチャンクの
実構造代表点を二重検査します。遅延確定で欠けた部品だけを元構造から再配置し、階段平滑化後も
20 tick待って再検査してから接合口を開くため、途中まで加工した状態では完了扱いにしません。
読み込み待ちは ticking area の `isFullyLoaded` も直接監視し、Promise が返らない場合でも
読み込み済みなら続行します。20秒以内に読み込めない領域は詳細付きで安全停止します。
各検査領域は最低1 tick保持し、解放後も1 tick空けて次の領域へ移るため、
同一tick内の連続作成・解放による読み込み競合を避けます。

```mcfunction
/scriptevent infinite_castle:rebuild_source_parts castle seed=42 smooth
/scriptevent infinite_castle:rebuild_source_parts floating seed=42 smooth
/scriptevent infinite_castle:rebuild_source_parts castle seed=42 authored
```

無限城ディメンションで試す場合は、既存30室の原点領域から離れた地点へ
スペクテイターで移動してから再構築します。再構築は、別ディメンションにあるものも含め、
保存済みの前回素材建築を先に自動消去します。

```mcfunction
/gamemode spectator @s
/execute in infinite_castle:dungeon run tp @s 1000 80 1000
/scriptevent infinite_castle:rebuild_source_parts castle seed=420320 smooth
```

検証後にこの素材元ワールドの元の観察地点へ戻る場合は、Bedrockの標準ディメンション名
`overworld` を使います。

```mcfunction
/execute in overworld run tp @s 2630 315 1600
/gamemode creative @s
```

新しい建築を作らず、保存済みの素材建築だけを消去する場合は次を実行します。
確認語なしで実行すると注意だけを表示し、消去しません。現行V2だけでなく、旧state keyで
記録された初期素材建築も対象です。保存された直方体範囲をair化するため、その範囲へ
後から置いたブロックも一緒に消えます。通常の30室版無限城はこのコマンドの対象外です。

```mcfunction
/scriptevent infinite_castle:clear_source_parts confirm
```

原点側にある通常の旧30室版を消す場合は、先に無限城dimensionから全員退出してから
オーバーワールドで実行します。`x=0..119 / y=0..63 / z=0..119` の全100セルを
air化し、保存グラフも解除します。完了表示まではワールドを閉じないでください。

```mcfunction
/execute in overworld run tp @s 2630 315 1600
/scriptevent infinite_castle:clear_dungeon_grid confirm
```

確認語なしでは注意だけを表示し、消去しません。旧30室版の通常生成・定期再構築・修復コマンドは
無効化されているため、以後は再生成されません。

旧30室版の消去から新しい三層・15室版の建築、入口部屋への移動までを一度に行う推奨コマンドです。
城内を無人にしてオーバーワールドから実行し、完了表示までワールドを閉じないでください。

```mcfunction
/execute in overworld run tp @s 2630 315 1600
/scriptevent infinite_castle:activate_source_castle confirm
```

通常の入口マーカーでも、初回は同じ移行を自動実行します。2回目以降は保存済みの新城を再利用し、
新しい入口部屋へ着地します。新城の出口へ入ると、入場前の地点へ帰還します。

鍵・報酬・中ボス・最終ボスの攻略進行は一時的に無効です。全室を自由に探索できます。

無限城内にプレイヤーがいる間だけ15分タイマーが動きます。時間になると攻略建築内では各プレイヤーがいる
部屋・廊下・橋・階段パーツと、それらへ直接接続する隣接パーツをその場に固定し、接続口を
鋳型として周囲を新しいseedで再構築します。装飾内・屋根上・空中・城の外からでも、最寄りの攻略棟を
鋳型にして再構築を開始します。複数人なら全員の周囲を安全領域として扱い、退避テレポートは行いません。
処理中にプレイヤーが消去・建築予定区画へ入った場合はその操作だけ待機し、離れると自動で続行します。
部分再構築では接合用空気領域の重複消去を省き、短い配置待ち＋1回の全検査を行います。
不整合が見つかった部品だけを再配置・再検査します。
無限城が無人になるとタイマーは解除され、次回入場から改めて15分を計測します。

部分再構築を15分待たずに実機確認する場合は、無限城ディメンション内の好きな位置から実行します。

```mcfunction
/scriptevent infinite_castle:force_reconstruct
```

## 深紅の夕焼けフォグと密集型の近景装飾城郭 (v0.1.36)

攻略可能な34建築・38接続は従来どおり独立したコアです。その下層・中層・上層の空きへ、攻略判定には一切使わない
装飾城郭を標準36棟配置します。ばらばらな単体配置ではなく、6棟ずつの城郭群を6か所に組み、各群を
交差廊下・部屋・橋・2本の階段・追加躯体で構成します。階段は必ず両端を大型建築に寄せ、孤立した階段や
空中に単独で浮く薄い建築を作りません。横向きなどの特殊姿勢は21候補のうち部屋2棟だけに絞り、
城郭群の壁面へ2ブロック間隔で付属させます。装飾には接続口加工、柵による接続、階段平滑化、
進行判定を適用しません。

標準36棟の内訳は交差廊下8・部屋8・橋8・階段12です。比較用の高密度44棟も同じ6群構成を保ち、
階段だけ20棟へ増やします。無限城ディメンション内で次のコマンドから切り替えられます。
seedを省略した場合は攻略コアのseedから決定し、同じ入力なら同じ配置です。

```mcfunction
/scriptevent infinite_castle:rebuild_scenery default
/scriptevent infinite_castle:rebuild_scenery dense
/scriptevent infinite_castle:rebuild_scenery dense seed=420320
```

装飾だけを消す場合は次を使います。`clear_source_parts confirm` は攻略コアと装飾の両方を消します。

```mcfunction
/scriptevent infinite_castle:clear_scenery confirm
```

装飾は攻略コア全体を囲む遠景リングではなく、各建築・接続口を個別判定して最短12ブロックの余白を
残した近景infillです。標準では攻略コアから最大48ブロック以内に各城郭群を収め、15分再構築では在室建築と直接隣接建築を維持しつつ、
各建築から最低8ブロック離れ、全プレイヤーの安全領域にも入らない候補だけを採用します。最初のseedで
候補がない場合は最大12候補を自動探索し、混雑時は同じ配置の安全な区画再設置へ切り替えるため、場所だけを理由に見送りません。
装飾自体は15分ごとに消去・再配置しないため、通常の再構築速度を悪化させません。

攻略建築内のプレイヤーは従来どおり在室棟と直接隣接棟を固定します。装飾城郭内では装飾をそのまま維持し、
屋根上・空中・城外を含むそれ以外の位置では、プレイヤーから上下左右に余白を取って別区画を再構築します。
攻略内・装飾内・外部のプレイヤーが混在していても全員を同時に保護します。

リソースパックの `infinite_castle:sunset_haze` は、無限城内だけ中遠景を深い朱赤の夕焼け色へ寄せます。
入場・退出・respawn・script再読込時に専用fog stackだけを同期し、他packのfogは消しません。

## v0.1 TODO

- 21種の本番 `.mcstructure` への置換
- 本格Loot/Mob/ボス/深層
- カテゴリ別の家具・建具バリエーション追加
