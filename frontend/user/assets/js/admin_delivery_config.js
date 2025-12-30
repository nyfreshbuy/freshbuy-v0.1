 (function () {
    const tip = document.getElementById("dcTip");

    const els = {
      areaZh: document.getElementById("dcAreaZh"),
      areaEn: document.getElementById("dcAreaEn"),
      areaNoteZh: document.getElementById("dcAreaNoteZh"),
      areaNoteEn: document.getElementById("dcAreaNoteEn"),
      frequencyZh: document.getElementById("dcFreqZh"),
      frequencyEn: document.getElementById("dcFreqEn"),
      dayZh: document.getElementById("dcDayZh"),
      dayEn: document.getElementById("dcDayEn"),
      timeWindowZh: document.getElementById("dcTimeZh"),
      timeWindowEn: document.getElementById("dcTimeEn"),
    };

    function show(msg) {
      if (tip) tip.textContent = msg || "";
    }

    // 先加载当前配置
    fetch("/api/site-config?v=" + Date.now(), { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const d = j?.data?.delivery;
        if (!d) return;
        els.areaZh.value = d.areaZh || "";
        els.areaEn.value = d.areaEn || "";
        els.areaNoteZh.value = d.areaNoteZh || "";
        els.areaNoteEn.value = d.areaNoteEn || "";
        els.frequencyZh.value = d.frequencyZh || "";
        els.frequencyEn.value = d.frequencyEn || "";
        els.dayZh.value = d.dayZh || "";
        els.dayEn.value = d.dayEn || "";
        els.timeWindowZh.value = d.timeWindowZh || "";
        els.timeWindowEn.value = d.timeWindowEn || "";
        show("已加载当前配送配置");
      })
      .catch(() => show("加载失败，请检查后端接口 /api/site-config"));

    // 保存
    document.getElementById("saveDeliveryConfigBtn")?.addEventListener("click", () => {
      const payload = {
        delivery: {
          areaZh: els.areaZh.value.trim(),
          areaEn: els.areaEn.value.trim(),
          areaNoteZh: els.areaNoteZh.value.trim(),
          areaNoteEn: els.areaNoteEn.value.trim(),
          frequencyZh: els.frequencyZh.value.trim(),
          frequencyEn: els.frequencyEn.value.trim(),
          dayZh: els.dayZh.value.trim(),
          dayEn: els.dayEn.value.trim(),
          timeWindowZh: els.timeWindowZh.value.trim(),
          timeWindowEn: els.timeWindowEn.value.trim(),
        },
      };

      fetch("/api/admin/site-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j?.success) show("✅ 保存成功！用户端 Footer 会自动更新（刷新页面即可看到）");
          else show("❌ 保存失败");
        })
        .catch(() => show("❌ 保存失败，请检查后端接口 /api/admin/site-config"));
    });
  })();
