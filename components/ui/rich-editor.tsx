"use client";

import { Markdown as MarkdownExt } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from "lucide-react";
import { forwardRef, type ReactNode, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { textDir } from "@/lib/dir";

const SAFE_URL = /^(https?:|mailto:|\/)/i;
const MENTION = /@([\p{L}\p{N} .'-]{0,30})$/u;

export type RichEditorHandle = {
  focus: () => void;
  clear: () => void;
  /** Replace the "@query" before the cursor with "@Name ". */
  insertMention: (name: string) => void;
};

type Props = {
  /** Markdown. Read once, when the editor mounts. */
  defaultValue?: string;
  onChange?: (markdown: string) => void;
  /** ⌘↵ / Ctrl↵ */
  onSubmit?: () => void;
  onEscape?: () => void;
  /** The text after an "@" right before the cursor, or null when there is none. */
  onMentionQuery?: (q: string | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
  toolbar?: boolean;
  className?: string;
  /** Rendered at the end of the toolbar row, e.g. a send button. */
  children?: ReactNode;
};

/**
 * WYSIWYG editing that stores markdown, so agents and the API keep reading plain
 * markdown. Markdown shortcuts (**bold**, "- ", "> ") work while typing. The
 * direction follows the text: 70% Hebrew or more and it flips to RTL.
 */
export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { defaultValue = "", onChange, onSubmit, onEscape, onMentionQuery, placeholder, autoFocus, toolbar = true, className, children },
  ref,
) {
  // Handlers change every render; the editor is built once, so it reads them through a ref.
  const cb = useRef({ onChange, onSubmit, onEscape, onMentionQuery });
  useLayoutEffect(() => {
    cb.current = { onChange, onSubmit, onEscape, onMentionQuery };
  });

  const mentionAt = (editor: Editor) => {
    const { $from, empty } = editor.state.selection;
    if (!empty) return null;
    const m = MENTION.exec($from.parent.textBetween(0, $from.parentOffset, undefined, "￼"));
    return m ? { q: m[1], from: $from.pos - m[0].length, to: $from.pos } : null;
  };

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      StarterKit.configure({
        underline: false, // markdown has no underline
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, isAllowedUri: (url) => SAFE_URL.test(url) },
      }),
      // Tables and checklists aren't in the toolbar, but existing markdown with them must survive an edit.
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      MarkdownExt,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: defaultValue,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "prose-chat rich-editor outline-none" },
      handleKeyDown: (_view, e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          cb.current.onSubmit?.();
          return true;
        }
        if (e.key === "Escape") cb.current.onEscape?.();
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      cb.current.onChange?.(editor.isEmpty ? "" : editor.getMarkdown());
      cb.current.onMentionQuery?.(mentionAt(editor)?.q ?? null);
    },
    onSelectionUpdate: ({ editor }) => cb.current.onMentionQuery?.(mentionAt(editor)?.q ?? null),
  });

  const dir = useEditorState({ editor, selector: ({ editor }) => textDir(editor?.getText()) }) ?? textDir(defaultValue);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus(),
      clear: () => editor?.commands.clearContent(true),
      insertMention: (name) => {
        if (!editor) return;
        const at = mentionAt(editor);
        const chain = editor.chain().focus();
        (at ? chain.insertContentAt({ from: at.from, to: at.to }, `@${name} `) : chain.insertContent(`@${name} `)).run();
        cb.current.onMentionQuery?.(null);
      },
    }),
    [editor],
  );

  return (
    <div dir={dir} className={className}>
      <EditorContent editor={editor} />
      {(toolbar || children) && (
        <div className="mt-1 flex items-center gap-0.5" dir="ltr">
          {toolbar && editor && <Toolbar editor={editor} />}
          {children && <div className="ml-auto">{children}</div>}
        </div>
      )}
    </div>
  );
});

function Toolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
    }),
  });
  const link = () => {
    if (editor.isActive("link")) return editor.chain().focus().unsetLink().run();
    const url = prompt("Link URL", "https://");
    if (!url) return;
    if (!SAFE_URL.test(url)) return alert("Links must start with https://, http://, mailto: or /.");
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };
  const buttons: [string, ReactNode, boolean, () => unknown][] = [
    ["Bold", <Bold key="b" size={15} />, active.bold, () => editor.chain().focus().toggleBold().run()],
    ["Italic", <Italic key="i" size={15} />, active.italic, () => editor.chain().focus().toggleItalic().run()],
    ["Strikethrough", <Strikethrough key="s" size={15} />, active.strike, () => editor.chain().focus().toggleStrike().run()],
    ["Code", <Code key="c" size={15} />, active.code, () => editor.chain().focus().toggleCode().run()],
    ["Bulleted list", <List key="ul" size={15} />, active.bullet, () => editor.chain().focus().toggleBulletList().run()],
    ["Numbered list", <ListOrdered key="ol" size={15} />, active.ordered, () => editor.chain().focus().toggleOrderedList().run()],
    ["Quote", <Quote key="q" size={15} />, active.quote, () => editor.chain().focus().toggleBlockquote().run()],
    ["Link", <Link2 key="l" size={15} />, active.link, link],
  ];
  return (
    <>
      {buttons.map(([label, icon, on, run]) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          aria-pressed={on}
          title={label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={run}
          className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-fg-3 hover:bg-hover hover:text-fg", on && "bg-hover text-fg")}
        >
          {icon}
        </button>
      ))}
    </>
  );
}
