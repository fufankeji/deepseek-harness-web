import * as Dialog from "@radix-ui/react-dialog";
import { FileText, LoaderCircle, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import styles from "./TextInputDialog.module.css";

export function TextInputDialog({
  open,
  title,
  description,
  initialValue,
  inputLabel,
  confirmLabel,
  pending = false,
  maxLength = 80,
  onOpenChange,
  onConfirm
}: {
  open: boolean;
  title: string;
  description: string;
  initialValue: string;
  inputLabel: string;
  confirmLabel: string;
  pending?: boolean;
  maxLength?: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (value: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [initialValue, open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = value.trim();
    if (normalized && !pending) void onConfirm(normalized);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content} onOpenAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => document.getElementById("themed-dialog-input")?.focus()); }}>
          <div className={styles.ambient} aria-hidden="true" />
          <header className={styles.header}>
            <span><FileText size={18} /></span>
            <div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div>
            <Dialog.Close className={styles.closeButton} aria-label="关闭弹窗" disabled={pending}><X size={17} /></Dialog.Close>
          </header>
          <form onSubmit={submit}>
            <label htmlFor="themed-dialog-input">{inputLabel}</label>
            <input id="themed-dialog-input" value={value} onChange={(event) => setValue(event.target.value)} maxLength={maxLength} autoComplete="off" />
            <div className={styles.counter}>{value.trim().length} / {maxLength}</div>
            <footer>
              <Dialog.Close asChild><button type="button" className={styles.cancelButton} disabled={pending}>取消</button></Dialog.Close>
              <button type="submit" className={styles.confirmButton} disabled={!value.trim() || pending}>{pending ? <><LoaderCircle className={styles.spinner} size={15} /> 正在保存</> : confirmLabel}</button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
