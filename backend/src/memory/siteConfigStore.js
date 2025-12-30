// backend/src/memory/siteConfigStore.js
let siteConfig = {
  delivery: {
    areaZh: "Fresh Meadows 及周边社区",
    areaEn: "Fresh Meadows and nearby neighborhoods",
    areaNoteZh: "以可下单区域为准",
    areaNoteEn: "subject to available service areas",

    frequencyZh: "每周固定配送 1 次",
    frequencyEn: "Scheduled delivery once per week",

    dayZh: "周五",
    dayEn: "Friday",

    timeWindowZh: "17:00 – 21:00（纽约时间）",
    timeWindowEn: "5:00 PM – 9:00 PM (NY time)",
  },
  updatedAt: new Date().toISOString(),
};

export function getSiteConfig() {
  return siteConfig;
}

export function updateSiteConfig(patch) {
  // 只允许更新 delivery
  const next = {
    ...siteConfig,
    ...patch,
    delivery: {
      ...siteConfig.delivery,
      ...(patch?.delivery || {}),
    },
    updatedAt: new Date().toISOString(),
  };
  siteConfig = next;
  return siteConfig;
}
