<!-- i18n: language-switcher -->
[English](INLINE_COMMENTS_RFC.md) | [日本語](INLINE_COMMENTS_RFC.ja.md)

# インラインアンカー付きコメント RFC

ステータス: ブロック／見出しアンカー付きコメントは実装可。任意テキスト範囲は保留。

関連issue: #258

## 問題点

ページレベルのコメントは議論に便利ですが、レビュアーは特定の見出し、リスト項目、段落、埋め込みブロックを指し示す必要がよくあります。Googleドキュメントのような範囲指定コメントシステムは、Markdownの編集でオフセットが常に変わり選択が無効になるためコストが高いです。

## 決定

アンカー付きブロックコメントから開始します：

- 見出しのスラッグ、フェンスブロックのID、または生成された段落／リスト項目のハッシュから導出される安定したブロックIDにアンカーを付ける。
- ページパス、アンカーID、オプションの引用プレビュー、通常のコメントスレッドIDを保存する。
- リーダーとエディターのプレビューでアンカーを小さなコメント表示としてレンダリングする。
- 編集後にアンカーが解決できない場合はページレベルコメントにフォールバックする。

最初のバージョンでは任意の文字範囲選択は実装しません。これは機能の中で最もリスクが高いため、同じスレッドモデルのもとで後から追加可能です。

## データモデルのスケッチ

`page_comments`の隣にテーブルを追加します：

```sql
CREATE TABLE page_comment_anchors (
  comment_id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  path TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX page_comment_anchors_page_idx ON page_comment_anchors(page_id);
CREATE INDEX page_comment_anchors_anchor_idx ON page_comment_anchors(path, anchor_id);
```

既存のコメント本文、作成者、解決状態、メンション処理は`page_comments`に残します。

## アンカー生成

- 見出し：Markdownレンダラーの既存のスラッグ化された見出しIDを使用。
- フェンスブロック：明示的な`id:`フィールドがあれば優先使用。なければフェンスの種類と正規化された本文をハッシュ化。
- 段落／リスト項目：正規化テキストをハッシュ化し、`p-4f8a21`のような短いプレフィックスを付ける。
- レンダリング時に複数のブロックが衝突した場合は発生順のサフィックスを付加。

## UIの着地点

- リーダー：対象ブロックの右端にコメントマーカーを表示。
- エディタープレビュー：プレビューやビジュアル面に同じマーカーを表示。
- コメントパネル：まずアンカーごとにグループ化し、次に未解決／解決状態で分類。
- 空のアンカー状態：ブロックが消えた場合は引用と「ページレベルフォールバック」ラベルを表示し、スレッドを隠さない。

## Go/No-Go

現在のMarkdownの正準モデルに合致し、既存のコメントサービスを再利用できるため、ブロック／見出しバージョンはGo。Markdownソース位置とレンダリングプレビューのノード間の安定したマッピングが確立されるまでは任意範囲はNo-Go。