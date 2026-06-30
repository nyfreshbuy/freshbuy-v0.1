function cleanValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return cleanValue(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSpec(item = {}) {
  return cleanValue(
    item.variantLabel ||
      item.specLabel ||
      item.spec ||
      item.unit ||
      item.packageSize ||
      item.variantName ||
      ""
  );
}

function stripTrailingDuplicateSpec(text, spec) {
  let out = cleanValue(text);
  const s = cleanValue(spec);
  if (!out || !s) return out;

  const esc = escapeRegExp(s);
  const explicitSpecBeforeParens = new RegExp(`(?:-|\\(|（)\\s*${esc}\\s*(?:\\)|）)?\\s*$`, "i");

  while (
    new RegExp(`\\s*[（(]\\s*${esc}\\s*[)）]\\s*$`, "i").test(out) &&
    explicitSpecBeforeParens.test(out.replace(new RegExp(`\\s*[（(]\\s*${esc}\\s*[)）]\\s*$`, "i"), ""))
  ) {
    out = out.replace(new RegExp(`\\s*[（(]\\s*${esc}\\s*[)）]\\s*$`, "i"), "").trim();
  }

  return out;
}

function formatInvoiceItemDescription(item = {}) {
  const spec = getSpec(item);
  const base = cleanValue(item.description || item.name || item.productName || "");

  if (!spec) return base;

  const cleaned = stripTrailingDuplicateSpec(base, spec);
  const esc = escapeRegExp(spec);
  if (new RegExp(`(^|[-\\s(（])${esc}([\\s)）]|$)`, "i").test(cleaned)) {
    return cleaned;
  }

  return cleaned ? `${cleaned} - ${spec}` : spec;
}

export { formatInvoiceItemDescription };
