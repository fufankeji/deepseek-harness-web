import * as Dialog from "@radix-ui/react-dialog";
import { LoaderCircle, Trash2, X } from "lucide-react";
import styles from "./ConfirmDialog.module.css";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  onOpenChange,
  onConfirm
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.ambient} aria-hidden="true" />
          <header className={styles.header}>
            <span><Trash2 size={18} /></span>
            <div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div>
            <Dialog.Close className={styles.closeButton} aria-label="关闭弹窗" disabled={pending}><X size={17} /></Dialog.Close>
          </header>
          <footer>
            <Dialog.Close asChild><button type="button" className={styles.cancelButton} disabled={pending}>取消</button></Dialog.Close>
            <button type="button" className={styles.confirmButton} disabled={pending} onClick={() => void onConfirm()}>{pending ? <><LoaderCircle className={styles.spinner} size={15} /> 正在删除</> : confirmLabel}</button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
