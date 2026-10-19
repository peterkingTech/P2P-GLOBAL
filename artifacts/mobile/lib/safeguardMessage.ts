// Child/teen safeguards (database migration 198) refuse with
// "P2P_MINOR_SAFEGUARD: <reason>". Show people the reason in plain words,
// never the internal marker. Any other error text is returned unchanged.
export function readableSendError(message: string | null | undefined): string {
  const text = message ?? "";
  if (!text.includes("P2P_MINOR_SAFEGUARD")) return text;
  const reason = text.replace(/^.*P2P_MINOR_SAFEGUARD:\s*/, "").trim();
  return reason ? `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.` : "This isn't available for this account.";
}
