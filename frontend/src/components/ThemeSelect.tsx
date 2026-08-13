import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import styles from "./ThemeSelect.module.css";

export interface ThemeSelectOption {
  value: string;
  label: string;
}

export function ThemeSelect({
  id,
  value,
  options,
  onValueChange,
  disabled = false,
  ariaLabel
}: {
  id?: string;
  value: string;
  options: ThemeSelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <Select.Trigger id={id} className={styles.trigger} aria-label={ariaLabel}>
        <Select.Value />
        <Select.Icon className={styles.triggerIcon}><ChevronDown size={15} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className={styles.content} position="popper" sideOffset={6} collisionPadding={12}>
          <Select.ScrollUpButton className={styles.scrollButton}><ChevronUp size={14} /></Select.ScrollUpButton>
          <Select.Viewport className={styles.viewport}>
            {options.map((option) => (
              <Select.Item className={styles.item} key={option.value} value={option.value}>
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className={styles.indicator}><Check size={14} /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className={styles.scrollButton}><ChevronDown size={14} /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
