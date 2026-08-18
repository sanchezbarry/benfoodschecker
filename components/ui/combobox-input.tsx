import * as React from "react";

import { Input } from "@/components/ui/input";

/**
 * A free-text input backed by a native `<datalist>`: the user can type anything
 * (a brand-new vendor code, a certificate type nobody has used yet) or pick from
 * the values already recorded elsewhere in the system. No JS, no state — it
 * renders fine inside Server Components.
 */
export function ComboboxInput({
  id,
  options,
  ...props
}: React.ComponentProps<typeof Input> & { id: string; options: string[] }) {
  const listId = `${id}-suggestions`;
  return (
    <>
      <Input id={id} list={options.length > 0 ? listId : undefined} {...props} />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </>
  );
}
