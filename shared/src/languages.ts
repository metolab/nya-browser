export const DEFAULT_CHROME_LANGUAGE = 'zh-CN';

export const PINNED_CHROME_LANGUAGES = ['zh-CN', 'zh-TW', 'en-US'] as const;

type Lang = { code: string; label: string; posix: string };

const CHROME_LANGUAGE_ROWS: Lang[] = [
  { code: 'zh-CN', label: '简体中文', posix: 'zh_CN.UTF-8' },
  { code: 'zh-TW', label: '繁体中文（台湾）', posix: 'zh_TW.UTF-8' },
  { code: 'en-US', label: '英语（美国）', posix: 'en_US.UTF-8' },
  { code: 'zh-HK', label: '繁体中文（香港）', posix: 'zh_HK.UTF-8' },
  { code: 'en-GB', label: '英语（英国）', posix: 'en_GB.UTF-8' },
  { code: 'en-AU', label: '英语（澳大利亚）', posix: 'en_AU.UTF-8' },
  { code: 'en-CA', label: '英语（加拿大）', posix: 'en_CA.UTF-8' },
  { code: 'en-IN', label: '英语（印度）', posix: 'en_IN.UTF-8' },
  { code: 'ja', label: '日语', posix: 'ja_JP.UTF-8' },
  { code: 'ko', label: '韩语', posix: 'ko_KR.UTF-8' },
  { code: 'th', label: '泰语', posix: 'th_TH.UTF-8' },
  { code: 'vi', label: '越南语', posix: 'vi_VN.UTF-8' },
  { code: 'id', label: '印度尼西亚语', posix: 'id_ID.UTF-8' },
  { code: 'ms', label: '马来语', posix: 'ms_MY.UTF-8' },
  { code: 'fil', label: '菲律宾语', posix: 'fil_PH.UTF-8' },
  { code: 'hi', label: '印地语', posix: 'hi_IN.UTF-8' },
  { code: 'bn', label: '孟加拉语', posix: 'bn_BD.UTF-8' },
  { code: 'ta', label: '泰米尔语', posix: 'ta_IN.UTF-8' },
  { code: 'te', label: '泰卢固语', posix: 'te_IN.UTF-8' },
  { code: 'mr', label: '马拉地语', posix: 'mr_IN.UTF-8' },
  { code: 'gu', label: '古吉拉特语', posix: 'gu_IN.UTF-8' },
  { code: 'kn', label: '卡纳达语', posix: 'kn_IN.UTF-8' },
  { code: 'ml', label: '马拉雅拉姆语', posix: 'ml_IN.UTF-8' },
  { code: 'pa', label: '旁遮普语', posix: 'pa_IN.UTF-8' },
  { code: 'ur', label: '乌尔都语', posix: 'ur_PK.UTF-8' },
  { code: 'si', label: '僧伽罗语', posix: 'si_LK.UTF-8' },
  { code: 'ne', label: '尼泊尔语', posix: 'ne_NP.UTF-8' },
  { code: 'my', label: '缅甸语', posix: 'my_MM.UTF-8' },
  { code: 'km', label: '高棉语', posix: 'km_KH.UTF-8' },
  { code: 'lo', label: '老挝语', posix: 'lo_LA.UTF-8' },
  { code: 'mn', label: '蒙古语', posix: 'mn_MN.UTF-8' },
  { code: 'kk', label: '哈萨克语', posix: 'kk_KZ.UTF-8' },
  { code: 'ky', label: '吉尔吉斯语', posix: 'ky_KG.UTF-8' },
  { code: 'uz', label: '乌兹别克语', posix: 'uz_UZ.UTF-8' },
  { code: 'az', label: '阿塞拜疆语', posix: 'az_AZ.UTF-8' },
  { code: 'ka', label: '格鲁吉亚语', posix: 'ka_GE.UTF-8' },
  { code: 'hy', label: '亚美尼亚语', posix: 'hy_AM.UTF-8' },
  { code: 'he', label: '希伯来语', posix: 'he_IL.UTF-8' },
  { code: 'ar', label: '阿拉伯语', posix: 'ar_SA.UTF-8' },
  { code: 'fa', label: '波斯语', posix: 'fa_IR.UTF-8' },
  { code: 'ps', label: '普什图语', posix: 'ps_AF.UTF-8' },
  { code: 'am', label: '阿姆哈拉语', posix: 'am_ET.UTF-8' },
  { code: 'sw', label: '斯瓦希里语', posix: 'sw_KE.UTF-8' },
  { code: 'af', label: '南非荷兰语', posix: 'af_ZA.UTF-8' },
  { code: 'zu', label: '祖鲁语', posix: 'zu_ZA.UTF-8' },
  { code: 'de', label: '德语', posix: 'de_DE.UTF-8' },
  { code: 'de-AT', label: '德语（奥地利）', posix: 'de_AT.UTF-8' },
  { code: 'de-CH', label: '德语（瑞士）', posix: 'de_CH.UTF-8' },
  { code: 'fr', label: '法语', posix: 'fr_FR.UTF-8' },
  { code: 'fr-CA', label: '法语（加拿大）', posix: 'fr_CA.UTF-8' },
  { code: 'fr-CH', label: '法语（瑞士）', posix: 'fr_CH.UTF-8' },
  { code: 'fr-BE', label: '法语（比利时）', posix: 'fr_BE.UTF-8' },
  { code: 'es', label: '西班牙语', posix: 'es_ES.UTF-8' },
  { code: 'es-419', label: '西班牙语（拉丁美洲）', posix: 'es_MX.UTF-8' },
  { code: 'es-MX', label: '西班牙语（墨西哥）', posix: 'es_MX.UTF-8' },
  { code: 'es-AR', label: '西班牙语（阿根廷）', posix: 'es_AR.UTF-8' },
  { code: 'es-US', label: '西班牙语（美国）', posix: 'es_US.UTF-8' },
  { code: 'pt-BR', label: '葡萄牙语（巴西）', posix: 'pt_BR.UTF-8' },
  { code: 'pt-PT', label: '葡萄牙语（葡萄牙）', posix: 'pt_PT.UTF-8' },
  { code: 'it', label: '意大利语', posix: 'it_IT.UTF-8' },
  { code: 'nl', label: '荷兰语', posix: 'nl_NL.UTF-8' },
  { code: 'nl-BE', label: '荷兰语（比利时）', posix: 'nl_BE.UTF-8' },
  { code: 'pl', label: '波兰语', posix: 'pl_PL.UTF-8' },
  { code: 'ru', label: '俄语', posix: 'ru_RU.UTF-8' },
  { code: 'uk', label: '乌克兰语', posix: 'uk_UA.UTF-8' },
  { code: 'be', label: '白俄罗斯语', posix: 'be_BY.UTF-8' },
  { code: 'bg', label: '保加利亚语', posix: 'bg_BG.UTF-8' },
  { code: 'cs', label: '捷克语', posix: 'cs_CZ.UTF-8' },
  { code: 'sk', label: '斯洛伐克语', posix: 'sk_SK.UTF-8' },
  { code: 'sl', label: '斯洛文尼亚语', posix: 'sl_SI.UTF-8' },
  { code: 'hr', label: '克罗地亚语', posix: 'hr_HR.UTF-8' },
  { code: 'sr', label: '塞尔维亚语', posix: 'sr_RS.UTF-8' },
  { code: 'sr-Latn', label: '塞尔维亚语（拉丁）', posix: 'sr_RS.UTF-8' },
  { code: 'bs', label: '波斯尼亚语', posix: 'bs_BA.UTF-8' },
  { code: 'mk', label: '马其顿语', posix: 'mk_MK.UTF-8' },
  { code: 'sq', label: '阿尔巴尼亚语', posix: 'sq_AL.UTF-8' },
  { code: 'ro', label: '罗马尼亚语', posix: 'ro_RO.UTF-8' },
  { code: 'hu', label: '匈牙利语', posix: 'hu_HU.UTF-8' },
  { code: 'el', label: '希腊语', posix: 'el_GR.UTF-8' },
  { code: 'tr', label: '土耳其语', posix: 'tr_TR.UTF-8' },
  { code: 'da', label: '丹麦语', posix: 'da_DK.UTF-8' },
  { code: 'sv', label: '瑞典语', posix: 'sv_SE.UTF-8' },
  { code: 'nb', label: '挪威语（书面）', posix: 'nb_NO.UTF-8' },
  { code: 'nn', label: '挪威语（新挪威）', posix: 'nn_NO.UTF-8' },
  { code: 'no', label: '挪威语', posix: 'nb_NO.UTF-8' },
  { code: 'fi', label: '芬兰语', posix: 'fi_FI.UTF-8' },
  { code: 'is', label: '冰岛语', posix: 'is_IS.UTF-8' },
  { code: 'et', label: '爱沙尼亚语', posix: 'et_EE.UTF-8' },
  { code: 'lv', label: '拉脱维亚语', posix: 'lv_LV.UTF-8' },
  { code: 'lt', label: '立陶宛语', posix: 'lt_LT.UTF-8' },
  { code: 'ga', label: '爱尔兰语', posix: 'ga_IE.UTF-8' },
  { code: 'cy', label: '威尔士语', posix: 'cy_GB.UTF-8' },
  { code: 'gd', label: '苏格兰盖尔语', posix: 'gd_GB.UTF-8' },
  { code: 'ca', label: '加泰罗尼亚语', posix: 'ca_ES.UTF-8' },
  { code: 'eu', label: '巴斯克语', posix: 'eu_ES.UTF-8' },
  { code: 'gl', label: '加利西亚语', posix: 'gl_ES.UTF-8' },
  { code: 'mt', label: '马耳他语', posix: 'mt_MT.UTF-8' },
  { code: 'lb', label: '卢森堡语', posix: 'lb_LU.UTF-8' },
  { code: 'rm', label: '罗曼什语', posix: 'rm_CH.UTF-8' },
  { code: 'fo', label: '法罗语', posix: 'fo_FO.UTF-8' },
  { code: 'as', label: '阿萨姆语', posix: 'as_IN.UTF-8' },
  { code: 'or', label: '奥里亚语', posix: 'or_IN.UTF-8' },
  { code: 'sa', label: '梵语', posix: 'sa_IN.UTF-8' },
  { code: 'sd', label: '信德语', posix: 'sd_PK.UTF-8' },
  { code: 'kok', label: '孔卡尼语', posix: 'kok_IN.UTF-8' },
  { code: 'mni', label: '曼尼普尔语', posix: 'mni_IN.UTF-8' },
  { code: 'bo', label: '藏语', posix: 'bo_CN.UTF-8' },
  { code: 'ug', label: '维吾尔语', posix: 'ug_CN.UTF-8' },
  { code: 'ii', label: '彝语', posix: 'ii_CN.UTF-8' },
  { code: 'yue', label: '粤语', posix: 'yue_HK.UTF-8' },
  { code: 'haw', label: '夏威夷语', posix: 'haw_US.UTF-8' },
  { code: 'mi', label: '毛利语', posix: 'mi_NZ.UTF-8' },
  { code: 'sm', label: '萨摩亚语', posix: 'sm_WS.UTF-8' },
  { code: 'to', label: '汤加语', posix: 'to_TO.UTF-8' },
  { code: 'ty', label: '塔希提语', posix: 'ty_PF.UTF-8' },
  { code: 'jv', label: '爪哇语', posix: 'jv_ID.UTF-8' },
  { code: 'su', label: '巽他语', posix: 'su_ID.UTF-8' },
  { code: 'ceb', label: '宿务语', posix: 'ceb_PH.UTF-8' },
  { code: 'hmn', label: '苗语', posix: 'hmn.UTF-8' },
  { code: 'eo', label: '世界语', posix: 'eo.UTF-8' },
  { code: 'la', label: '拉丁语', posix: 'la.UTF-8' },
  { code: 'yi', label: '意第绪语', posix: 'yi.UTF-8' },
  { code: 'iw', label: '希伯来语（旧码）', posix: 'he_IL.UTF-8' },
  { code: 'ku', label: '库尔德语', posix: 'ku_TR.UTF-8' },
  { code: 'ckb', label: '中库尔德语', posix: 'ckb_IQ.UTF-8' },
  { code: 'tg', label: '塔吉克语', posix: 'tg_TJ.UTF-8' },
  { code: 'tk', label: '土库曼语', posix: 'tk_TM.UTF-8' },
  { code: 'tt', label: '鞑靼语', posix: 'tt_RU.UTF-8' },
  { code: 'ba', label: '巴什基尔语', posix: 'ba_RU.UTF-8' },
  { code: 'cv', label: '楚瓦什语', posix: 'cv_RU.UTF-8' },
  { code: 'os', label: '奥塞梯语', posix: 'os_RU.UTF-8' },
  { code: 'ce', label: '车臣语', posix: 'ce_RU.UTF-8' },
  { code: 'sah', label: '雅库特语', posix: 'sah_RU.UTF-8' },
  { code: 'mn-Mong', label: '蒙古语（传统）', posix: 'mn_MN.UTF-8' },
  { code: 'dz', label: '宗卡语', posix: 'dz_BT.UTF-8' },
  { code: 'ti', label: '提格利尼亚语', posix: 'ti_ET.UTF-8' },
  { code: 'so', label: '索马里语', posix: 'so_SO.UTF-8' },
  { code: 'om', label: '奥罗莫语', posix: 'om_ET.UTF-8' },
  { code: 'ha', label: '豪萨语', posix: 'ha_NG.UTF-8' },
  { code: 'yo', label: '约鲁巴语', posix: 'yo_NG.UTF-8' },
  { code: 'ig', label: '伊博语', posix: 'ig_NG.UTF-8' },
  { code: 'ff', label: '富拉语', posix: 'ff_SN.UTF-8' },
  { code: 'wo', label: '沃洛夫语', posix: 'wo_SN.UTF-8' },
  { code: 'sn', label: '修纳语', posix: 'sn_ZW.UTF-8' },
  { code: 'ny', label: '齐切瓦语', posix: 'ny_MW.UTF-8' },
  { code: 'rw', label: '卢旺达语', posix: 'rw_RW.UTF-8' },
  { code: 'rn', label: '基隆迪语', posix: 'rn_BI.UTF-8' },
  { code: 'lg', label: '卢干达语', posix: 'lg_UG.UTF-8' },
  { code: 'ak', label: '阿坎语', posix: 'ak_GH.UTF-8' },
  { code: 'tw', label: '契维语', posix: 'tw_GH.UTF-8' },
  { code: 'ee', label: '埃维语', posix: 'ee_GH.UTF-8' },
  { code: 'xh', label: '科萨语', posix: 'xh_ZA.UTF-8' },
  { code: 'st', label: '南索托语', posix: 'st_ZA.UTF-8' },
  { code: 'tn', label: '茨瓦纳语', posix: 'tn_ZA.UTF-8' },
  { code: 'ts', label: '聪加语', posix: 'ts_ZA.UTF-8' },
  { code: 'ss', label: '斯威士语', posix: 'ss_SZ.UTF-8' },
  { code: 've', label: '文达语', posix: 've_ZA.UTF-8' },
  { code: 'nr', label: '南恩德贝莱语', posix: 'nr_ZA.UTF-8' },
  { code: 'nso', label: '北索托语', posix: 'nso_ZA.UTF-8' },
  { code: 'mg', label: '马尔加什语', posix: 'mg_MG.UTF-8' },
  { code: 'qu', label: '克丘亚语', posix: 'qu_PE.UTF-8' },
  { code: 'ay', label: '艾马拉语', posix: 'ay_BO.UTF-8' },
  { code: 'gn', label: '瓜拉尼语', posix: 'gn_PY.UTF-8' },
  { code: 'ht', label: '海地克里奥尔语', posix: 'ht_HT.UTF-8' },
  { code: 'br', label: '布列塔尼语', posix: 'br_FR.UTF-8' },
  { code: 'co', label: '科西嘉语', posix: 'co_FR.UTF-8' },
  { code: 'oc', label: '奥克语', posix: 'oc_FR.UTF-8' },
  { code: 'fy', label: '西弗里西亚语', posix: 'fy_NL.UTF-8' },
  { code: 'li', label: '林堡语', posix: 'li_NL.UTF-8' },
  { code: 'wa', label: '瓦隆语', posix: 'wa_BE.UTF-8' },
  { code: 'ast', label: '阿斯图里亚斯语', posix: 'ast_ES.UTF-8' },
  { code: 'an', label: '阿拉贡语', posix: 'an_ES.UTF-8' },
  { code: 'sc', label: '萨丁语', posix: 'sc_IT.UTF-8' },
  { code: 'vec', label: '威尼斯语', posix: 'vec_IT.UTF-8' },
  { code: 'fur', label: '弗留利语', posix: 'fur_IT.UTF-8' },
];

const BY_CODE = new Map(CHROME_LANGUAGE_ROWS.map((row) => [row.code, row]));

export const CHROME_LANGUAGES = (() => {
  const pinned = PINNED_CHROME_LANGUAGES.filter((code) => BY_CODE.has(code));
  const seen = new Set<string>(pinned);
  const rest = CHROME_LANGUAGE_ROWS.map((row) => row.code)
    .filter((code) => {
      if (seen.has(code)) return false;
      seen.add(code);
      return true;
    })
    .sort((a, b) => chromeLanguageLabel(a).localeCompare(chromeLanguageLabel(b), 'zh'));
  return [...pinned, ...rest];
})();

export const CHROME_LANGUAGE_LIST = CHROME_LANGUAGES as unknown as [string, ...string[]];

export type ChromeLanguage = (typeof CHROME_LANGUAGES)[number];

export function chromeLanguageLabel(code: string) {
  return BY_CODE.get(code)?.label || code;
}

export function chromeLanguageOptionLabel(code: string) {
  return `${chromeLanguageLabel(code)} · ${code}`;
}

export function isValidChromeLanguage(input: string) {
  return BY_CODE.has(String(input || '').trim());
}

export function normalizeChromeLanguage(input: unknown): string {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_CHROME_LANGUAGE;
  if (!BY_CODE.has(raw)) throw new Error('Invalid chrome language');
  return raw;
}

export function posixLocale(language: string) {
  return BY_CODE.get(language)?.posix || 'C.UTF-8';
}

export function acceptLanguageHeader(language: string) {
  const parts = [language];
  const base = language.split('-')[0];
  if (base && base !== language) parts.push(base);
  if (language !== 'en-US' && language !== 'en') {
    parts.push('en-US', 'en');
  } else if (language === 'en-US') {
    parts.push('en');
  }
  return [...new Set(parts)].join(',');
}
