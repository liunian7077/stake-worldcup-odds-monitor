const COUNTRY_ZH = new Map(
  Object.entries({
    Algeria: "阿尔及利亚",
    Argentina: "阿根廷",
    Australia: "澳大利亚",
    Austria: "奥地利",
    Belgium: "比利时",
    "Bosnia and Herzegovina": "波黑",
    Brazil: "巴西",
    Canada: "加拿大",
    "Cape Verde": "佛得角",
    Colombia: "哥伦比亚",
    "Congo DR": "刚果（金）",
    Croatia: "克罗地亚",
    Curacao: "库拉索",
    Czechia: "捷克",
    Ecuador: "厄瓜多尔",
    Egypt: "埃及",
    England: "英格兰",
    France: "法国",
    Germany: "德国",
    Ghana: "加纳",
    Haiti: "海地",
    "IR Iran": "伊朗",
    Iraq: "伊拉克",
    "Ivory Coast": "科特迪瓦",
    Japan: "日本",
    Jordan: "约旦",
    "Korea Republic": "韩国",
    Mexico: "墨西哥",
    Morocco: "摩洛哥",
    Netherlands: "荷兰",
    "New Zealand": "新西兰",
    Norway: "挪威",
    Panama: "巴拿马",
    Paraguay: "巴拉圭",
    Portugal: "葡萄牙",
    Qatar: "卡塔尔",
    "Saudi Arabia": "沙特阿拉伯",
    Scotland: "苏格兰",
    Senegal: "塞内加尔",
    "South Africa": "南非",
    Spain: "西班牙",
    Sweden: "瑞典",
    Switzerland: "瑞士",
    Tunisia: "突尼斯",
    Turkiye: "土耳其",
    USA: "美国",
    Uruguay: "乌拉圭",
    Uzbekistan: "乌兹别克斯坦",
    Draw: "平局",
    Other: "其他"
  })
);

export function localizeName(name) {
  const text = String(name ?? "").trim();
  return COUNTRY_ZH.get(text) ?? text;
}

export function localizeFixtureName(name) {
  return String(name ?? "")
    .split(/\s+-\s+/)
    .map((part) => localizeName(part))
    .join(" - ");
}

export function localizeCompetitors(competitors) {
  if (!Array.isArray(competitors)) {
    return [];
  }
  return competitors.map((competitor) => {
    if (typeof competitor === "string") {
      return localizeName(competitor);
    }
    if (competitor && typeof competitor === "object") {
      return {
        ...competitor,
        rawName: competitor.name,
        name: localizeName(competitor.name)
      };
    }
    return competitor;
  });
}

export function localizeOutcomeName(name) {
  if (/\d+\s*[:\-x]\s*\d+/i.test(String(name ?? ""))) {
    return String(name);
  }
  return localizeName(name);
}
