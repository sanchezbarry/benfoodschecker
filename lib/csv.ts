/**
 * CSV for spreadsheets, not for machines.
 *
 * The file this produces is opened in Excel by people who will sort, filter and
 * pivot it, which is what the three unobvious details below are for.
 */

/**
 * Excel and Sheets evaluate a cell that opens with one of these, so a
 * certificate type someone typed as "=ISO 22000" would run as a formula on
 * whoever opens the report — the CSV injection classic. Prefixing with an
 * apostrophe forces it back to text.
 */
const RISKY_START = /^[=+\-@\t\r]/;

/** …but a negative number is not an attack, and must stay a number. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

function cell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const guarded =
    RISKY_START.test(raw) && !PLAIN_NUMBER.test(raw) ? `'${raw}` : raw;

  // Quote only when the value would otherwise break the row apart.
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * Serialise rows (the first being the header) to a CSV document.
 *
 * Leads with a UTF-8 BOM: without it Excel on Windows reads the bytes as the
 * local codepage and mangles every non-ASCII vendor name. Rows end with CRLF,
 * which is what RFC 4180 asks for and what the same Excel is happiest with.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const body = rows.map((row) => row.map(cell).join(",")).join("\r\n");
  return `\uFEFF${body}\r\n`;
}
