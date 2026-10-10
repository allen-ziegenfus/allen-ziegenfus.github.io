import "@mdxeditor/editor/style.css";
import {
  BlockTypeSelect, BoldItalicUnderlineToggles, CreateLink, DiffSourceToggleWrapper, diffSourcePlugin,
  headingsPlugin, InsertTable, linkDialogPlugin, linkPlugin, listsPlugin, ListsToggle,
  markdownShortcutPlugin, MDXEditor, quotePlugin, Separator, tablePlugin, thematicBreakPlugin,
  toolbarPlugin, UndoRedo,
} from "@mdxeditor/editor";

/**
 * Formatierender Editor, der reines Markdown liest und schreibt, für die
 * Inhaltsseiten. Nur, was die Seite darstellt: Überschriften 2–3 (der Seitentitel
 * ist die h1), fett, kursiv, Links, Listen, Zitate, Tabellen. Kein Unterstreichen —
 * Markdown kennt das nicht, es würde als HTML gespeichert. „Quelltext“ zeigt das
 * rohe Markdown.
 *
 * `markdown` wird einmal gelesen; für eine andere Seite der Komponente je Seite
 * einen eigenen `key` geben.
 */
export default function MarkdownEditor({ markdown, onAenderung, nurLesen }) {
  return (
    <div className="border rounded markdown-editor">
      <style>{`
        .markdown-editor .md-content { min-height: 12rem; }
        .markdown-editor .md-content h2 { font-size: 1.25rem; margin: 1em 0 .5em; }
        .markdown-editor .md-content h3 { font-size: 1.1rem; font-weight: 600; margin: 1em 0 .5em; }
        .markdown-editor .md-content p { margin-bottom: .75em; }
        .markdown-editor .md-content ul { list-style: disc; padding-left: 1.5em; }
        .markdown-editor .md-content ol { list-style: decimal; padding-left: 1.5em; }
        .markdown-editor .md-content a { color: #1e40af; text-decoration: underline; }
        .markdown-editor .md-content blockquote { border-left: 3px solid #ccc; padding-left: 1em; }
      `}</style>
      <MDXEditor
        markdown={markdown}
        onChange={onAenderung}
        readOnly={nurLesen}
        contentEditableClassName="md-content"
        plugins={[
          headingsPlugin({ allowedHeadingLevels: [2, 3] }),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          tablePlugin(),
          markdownShortcutPlugin(),
          diffSourcePlugin({ viewMode: "rich-text" }),
          toolbarPlugin({
            toolbarContents: () => (
              <DiffSourceToggleWrapper options={["rich-text", "source"]}>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
                <BlockTypeSelect />
                <Separator />
                <ListsToggle options={["bullet", "number"]} />
                <CreateLink />
                <InsertTable />
              </DiffSourceToggleWrapper>
            ),
          }),
        ]}
      />
    </div>
  );
}
