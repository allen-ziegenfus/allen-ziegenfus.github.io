import "@mdxeditor/editor/style.css";
import {
  BlockTypeSelect, BoldItalicUnderlineToggles, CreateLink, DiffSourceToggleWrapper, diffSourcePlugin,
  headingsPlugin, InsertTable, linkDialogPlugin, linkPlugin, listsPlugin, ListsToggle,
  markdownShortcutPlugin, MDXEditor, quotePlugin, Separator, tablePlugin, thematicBreakPlugin,
  toolbarPlugin, UndoRedo,
} from "@mdxeditor/editor";

/**
 * Formatting editor that reads and writes plain Markdown, for the content pages.
 * Only what the site renders: headings 2–3 (the page title is the h1), bold,
 * italic, links, lists, quotes, tables. No underline — Markdown has none, it
 * would be stored as HTML. "Quelltext" shows the raw Markdown.
 *
 * `markdown` is read once; give the component a `key` per page to load another.
 */
export default function MarkdownEditor({ markdown, onChange, readOnly }) {
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
        onChange={onChange}
        readOnly={readOnly}
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
