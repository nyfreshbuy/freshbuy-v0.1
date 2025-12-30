// backend/src/memory/settingsStore.js

// 用一个对象存所有“系统设置类”的东西，先只放配送方式说明
let settings = {
  deliveryInstructions: `
📦 配送方式说明（示例）

1️⃣ 次日配送：
· 下午 6 点前下单，默认次日 14:00 - 18:00 送达
· 如遇爆单或极端天气，可能顺延 1 天

2️⃣ 好友拼单：
· 多个好友使用同一地址下单，可平摊运费
· 由系统自动计算每人应付运费金额

3️⃣ 区域团购：
· 每周固定区域免运费日，需满足最低消费金额
· 下单后统一时间集中配送

4️⃣ 爆品日 / 体验日：
· 指定日期，只卖爆品/体验商品
· 统一次日或指定时间段配送

（以上只是示例，后台可随时修改）
`.trim()
};

// 读取配送说明
export function getDeliveryInstructions() {
  return settings.deliveryInstructions || "";
}

// 更新配送说明
export function updateDeliveryInstructions(newContent) {
  settings.deliveryInstructions = newContent || "";
  return settings.deliveryInstructions;
}
