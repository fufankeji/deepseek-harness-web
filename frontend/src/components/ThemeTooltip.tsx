import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";
import styles from "./ThemeTooltip.module.css";

export function ThemeTooltip({ content, children, side = "right" }: { content: string; children: ReactElement; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={styles.content} side={side} sideOffset={8} collisionPadding={10}>
          {content}
          <Tooltip.Arrow className={styles.arrow} width={10} height={5} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
