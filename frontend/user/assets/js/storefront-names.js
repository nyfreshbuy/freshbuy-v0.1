/* Display-only English labels for the current catalog. Database names are unchanged.
   Explicit bilingual API fields take precedence. Unknown names have no invented translation. */
(function () {
  "use strict";
  const labels = {
  "金瑞益黑芝麻发": "Jin Rui Yi Black Sesame",
  "元气森林自在税红豆薏米": "Genki Forest Red Bean & Coix",
  "宝发金针菜": "Dried Daylily Buds",
  "喜茶茉莉清抹原味茶": "Heytea Jasmine Tea",
  "水溶C柠檬": "Lemon Vitamin C Drink",
  "宝鼎天鱼上海白醋": "Shanghai White Vinegar",
  "六月香大酱": "Soybean Paste",
  "皇品味绍兴料酒": "Shaoxing Cooking Wine",
  "小龙坎火锅底料": "Xiaolongkan Hot Pot Soup Base",
  "东湖山西老陈醋": "Donghu Shanxi Aged Vinegar",
  "冰峰汽水": "Bingfeng Soda",
  "巧媳妇烤麸": "Wheat Gluten",
  "自在水陈皮山楂": "Tangerine Peel & Hawthorn Drink",
  "东方树叶红茶": "Oriental Leaf Black Tea",
  "东方树叶乌龙茶": "Oriental Leaf Oolong Tea",
  "牛头牌红葱酱": "Bull Head Shallot Sauce",
  "利民甜面酱": "Limin Sweet Bean Sauce",
  "王致和大块腐乳": "Wangzhihe Fermented Bean Curd",
  "鲁花5s压榨一级花生油": "Luhua Pressed Peanut Oil",
  "海天招牌老抽王": "Haitian Dark Soy Sauce",
  "皇后牌番薯粉粗": "Coarse Sweet Potato Noodles",
  "东方树叶青柑普洱": "Oriental Leaf Tangerine Pu-erh Tea",
  "金花白矾粉": "Alum Powder",
  "六婆辣椒面": "Liupo Chili Powder",
  "黎红藤椒油": "Green Sichuan Pepper Oil",
  "黎红花椒油": "Sichuan Pepper Oil",
  "poland spring矿泉水": "Poland Spring Water",
  "康师傅茉莉蜜茶": "Master Kong Jasmine Honey Tea",
  "康师傅冰红茶500ml": "Master Kong Iced Black Tea · 500 ml",
  "三牛万年青饼干": "Sanniu Crackers",
  "韩国白熊面": "Korean Instant Noodles",
  "王老吉": "Wang Lao Ji Herbal Tea",
  "新东阳关庙面细": "Hsin Tung Yang Thin Guanmiao Noodles",
  "六月香甜面酱": "Sweet Bean Sauce",
  "鼓山福建老酒": "Gushan Fujian Cooking Wine",
  "王致和韭花酱": "Wangzhihe Chive Flower Sauce",
  "业丰养生咸蛋": "Salted Eggs",
  "旺仔牛奶纸盒": "Want Want Milk · Carton",
  "维他清心栈冬蜜青柠": "Vita Honey & Lime Drink",
  "海天味极鲜": "Haitian Light Soy Sauce",
  "出前一丁酱油猪骨汤面": "Demae Ramen · Soy Sauce & Tonkotsu",
  "出前一丁海鲜味": "Demae Ramen · Seafood",
  "出前一丁鸡蓉味": "Demae Ramen · Chicken",
  "李先生鹌鹑蛋（罐头）": "Canned Quail Eggs",
  "东方树叶茉莉花茶": "Oriental Leaf Jasmine Tea",
  "桐裕火锅川粉": "Hot Pot Sweet Potato Noodles",
  "洽洽原香瓜子": "Chacha Original Sunflower Seeds",
  "鸡牌是拉差甜辣酱": "Sriracha Sweet Chili Sauce",
  "周黑鸭卤料": "Zhou Hei Ya Braising Spice Mix",
  "哇米诺豆奶": "Vamino Soy Milk",
  "三象粘米粉": "Erawan Rice Flour",
  "三象糯米粉": "Erawan Glutinous Rice Flour",
  "惠尔康牛奶花生": "Milk & Peanut Drink",
  "旺仔牛奶": "Want Want Milk",
  "味一村水牛奶蛋糕": "Buffalo Milk Cake",
  "味一村骆驼奶蛋糕": "Camel Milk Cake",
  "三蟹鱼露": "Three Crabs Fish Sauce",
  "乐事亨氏番茄酱味薯片": "Lay's Heinz Ketchup Potato Chips",
  "乐事经典原味薯片": "Lay's Classic Potato Chips",
  "果子熟了栀栀乌龙": "Gardenia Oolong Tea",
  "椰树椰汁（纸盒）": "Coconut Palm Coconut Milk · Carton",
  "椰树牌椰汁（纸盒）": "Coconut Palm Coconut Milk · Carton",
  "美汁源百香果柠檬": "Minute Maid Passion Fruit & Lemon",
  "美汁源热带果粒": "Minute Maid Tropical Fruit Drink",
  "美汁源汁汁桃桃": "Minute Maid Peach Drink",
  "旧街场无糖咖啡": "OldTown White Coffee · Unsweetened",
  "旧街场榛果咖啡": "OldTown White Coffee · Hazelnut",
  "旧街场经典咖啡": "OldTown White Coffee · Classic",
  "泰山八宝粥": "Taisun Mixed Congee",
  "娃哈哈AD钙奶": "Wahaha Milk Drink",
  "SCOTT厕所卷纸": "Scott Toilet Tissue",
  "庄园咸鸭蛋": "Salted Duck Eggs",
  "绿鹿粉干": "Rice Noodles",
  "双塔龙口粉丝": "Longkou Vermicelli",
  "茶派茉莉西柚": "Tea Pi Jasmine & Grapefruit Tea",
  "康师傅茉莉清茶": "Master Kong Jasmine Tea",
  "绿草地家庭蛋面": "Family Egg Noodles",
  "康师傅老坛酸菜牛肉面": "Master Kong Pickled Mustard Beef Noodles",
  "康师傅红烧牛肉面": "Master Kong Braised Beef Noodles",
  "出前一丁红烧牛肉面": "Demae Ramen · Braised Beef",
  "出前一丁猪骨浓汤面": "Demae Ramen · Tonkotsu",
  "出前一丁五香牛肉面": "Demae Ramen · Five Spice Beef",
  "出前一丁麻油味面": "Demae Ramen · Sesame Oil",
  "李锦记旧庄蚝油": "Lee Kum Kee Premium Oyster Sauce",
  "螺霸王螺蛳粉麻辣味280g": "Luobawang Spicy Rice Noodles · 280 g",
  "螺霸王螺蛳粉番茄味280g": "Luobawang Tomato Rice Noodles · 280 g",
  "螺霸王螺蛳粉原味280g": "Luobawang Original Rice Noodles · 280 g",
  "北冰洋桔汁": "Arctic Ocean Mandarin Soda",
  "北冰洋橙汁罐装": "Arctic Ocean Orange Soda · Can",
  "茶派蜜桃乌龙500ml": "Tea Pi Peach Oolong Tea · 500 ml",
  "黄国宝米15lb": "Kokuho Yellow Rice · 15 lb",
  "三象泰国茉莉香米25lb": "Thai Jasmine Rice · 25 lb",
  "美汁源果粒橙": "Minute Maid Orange Drink",
  "康师傅绿茶500ml": "Master Kong Green Tea · 500 ml",
  "元气森林白桃味气泡水450ml": "Genki Forest White Peach Sparkling Water · 450 ml",
  "金梅镇江香醋": "Zhenjiang Fragrant Vinegar"
};
  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function names(product, displayName) {
    const p = product || {};
    const original = String(p.nameZh || p.name_zh || p.chineseName || p.name || "").trim();
    const shown = String(displayName || original || "商品").trim();
    let en = String(p.nameEn || p.name_en || p.englishName || labels[original] || labels[original.split(" - ")[0]] || "").trim();
    let zh = shown;
    // Also accept a combined name when the existing catalog already contains two lines.
    const lines = shown.split(/\n|\s+[|｜]\s+/).filter(Boolean);
    if (lines.length > 1 && /[a-z]/i.test(lines[lines.length - 1])) {
      if (!en) en = lines.pop();
      zh = lines.join(" ");
    }
    return { zh, en };
  }
  window.FBNames = {
    escape,
    names,
    html(product, displayName) {
      const value = names(product, displayName);
      return '<span class="fb-name-zh">' + escape(value.zh) + '</span>' +
        (value.en ? '<span class="fb-name-en" lang="en">' + escape(value.en) + '</span>' : "");
    },
    search(product) {
      const value = names(product);
      return (value.zh + " " + value.en).toLowerCase();
    }
  };
})();
