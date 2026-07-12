(function (Budget) {
  "use strict";

  const fmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
  const fmtSigned = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, signDisplay: "always" });

  function money(n) {
    return fmt.format(n);
  }

  function signed(n) {
    return fmtSigned.format(n);
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function fullDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  }

  function dayMonth(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  Budget.format = { money, signed, todayISO, fullDate, dayMonth };
})(window.Budget = window.Budget || {});
