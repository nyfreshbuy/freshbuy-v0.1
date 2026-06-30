(function () {
  function cleanPart(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeForCompare(value) {
    return cleanPart(value)
      .toLowerCase()
      .replace(/[（）]/g, (ch) => (ch === "（" ? "(" : ")"))
      .replace(/\s+/g, "")
      .replace(/[‐‑‒–—―]/g, "-");
  }

  function getSpecLabel(item) {
    item = item || {};
    return cleanPart(
      item.variantLabel ||
        item.specLabel ||
        item.spec ||
        item.unit ||
        item.packageSize ||
        item.variantName ||
        ""
    );
  }

  function hasExplicitSpec(text, spec) {
    const value = cleanPart(text);
    const valueNorm = normalizeForCompare(value);
    const specNorm = normalizeForCompare(spec);
    if (!valueNorm || !specNorm) return false;
    return (
      valueNorm === specNorm ||
      valueNorm.endsWith(`-${specNorm}`) ||
      valueNorm.endsWith(`(${specNorm})`)
    );
  }

  function stripTrailingDuplicateSpec(base, spec) {
    const specNorm = normalizeForCompare(spec);
    let out = cleanPart(base);
    if (!out || !specNorm) return out;

    const suffixes = [
      ` (${spec})`,
      `（${spec}）`,
      ` - ${spec}`,
      `-${spec}`,
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const suffix of suffixes) {
        if (!out.endsWith(suffix)) continue;
        const next = cleanPart(out.slice(0, -suffix.length));
        if (hasExplicitSpec(next, spec)) {
          out = next;
          changed = true;
        }
      }
    }

    return out;
  }

  function formatInvoiceItemDescription(item) {
    item = item || {};
    const rawBase = cleanPart(item.description || item.name || item.productName || "");
    const spec = getSpecLabel(item);
    const base = spec ? stripTrailingDuplicateSpec(rawBase, spec) : rawBase;

    if (!base) return spec;
    if (!spec) return base;

    const baseNorm = normalizeForCompare(base);
    const specNorm = normalizeForCompare(spec);
    if (!specNorm || baseNorm.includes(specNorm)) return base;

    return `${base} - ${spec}`;
  }

  window.FreshbuyInvoiceFormat = {
    formatInvoiceItemDescription,
  };
  window.formatInvoiceItemDescription = formatInvoiceItemDescription;
})();
