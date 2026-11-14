/**
 * Editorial photography, self-hosted from Wikimedia Commons (resized to WebP).
 * Every image keeps its author, licence and source page; /credits lists them all.
 */
export type Photo = { place: string; author: string; license: string; source: string }

export const PHOTOS = {
  'amber-fort': { place: "Amber Fort, Jaipur", author: "Jakub Ha\u0142un", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:20191219_Fort_Amber,_Amer,_Jaipur_0955_9481.jpg" },
  'hussain-sagar': { place: "Hussain Sagar, Hyderabad", author: "iMahesh", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Aerial_view_of_Hussain_Sagar_from_Bansalipet.jpg" },
  'birla-mandir-hyderabad': { place: "Birla Mandir, Hyderabad", author: "Nikhilb239", license: "CC BY 4.0", source: "https://commons.wikimedia.org/wiki/File:Birla_Mandir,_Hyderabad.png" },
  'charminar': { place: "Charminar, Hyderabad", author: "DidierTais", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Charminar_Hyderabad_1.jpg" },
  'chowmahalla-palace': { place: "Chowmahalla Palace, Hyderabad", author: "Bernard Gagnon", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Chowmahalla_Palace_01.jpg" },
  'hawa-mahal': { place: "Hawa Mahal, Jaipur", author: "Chainwit.", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:East_facade_Hawa_Mahal_Jaipur_from_ground_level_(July_2022)_-_img_01.jpg" },
  'golconda': { place: "Golconda Fort, Hyderabad", author: "Bernard Gagnon", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Golconda_Fort_005.jpg" },
  'jal-mahal': { place: "Jal Mahal, Jaipur", author: "A.Savin", license: "FAL", source: "https://commons.wikimedia.org/wiki/File:Jaipur_03-2016_39_Jal_Mahal_-_Water_Palace.jpg" },
  'jantar-mantar-jaipur': { place: "Jantar Mantar, Jaipur", author: "Knowledge Seeker", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Jantar_Mantar_at_Jaipur.jpg" },
  'makkah-masjid-hyderabad': { place: "Mecca Masjid, Hyderabad", author: "Suraj Garg", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Mecca_Masjid_Hyderabad.JPG" },
  'nahargarh-fort': { place: "Nahargarh Fort, Jaipur", author: "Sanyam Bahga", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Nahargarh_13.jpg" },
  'qutb-shahi-tombs': { place: "Qutb Shahi Tombs, Hyderabad", author: "Alaka123", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Qutb_Shahi_Tomb_5.jpg" },
  'salar-jung-museum': { place: "Salar Jung Museum, Hyderabad", author: "Omer123hussain", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Salar_Jung_Museum,_Hyderabad,_India.jpg" },
} satisfies Record<string, Photo>

export type PhotoId = keyof typeof PHOTOS

export const photoSrc = (id: PhotoId, small = false) => `/stories/${id}${small ? '-sm' : ''}.webp`
export const photoSrcSet = (id: PhotoId) => `/stories/${id}-sm.webp 960w, /stories/${id}.webp 1920w`
export const credit = (id: PhotoId) => `${PHOTOS[id].place} · ${PHOTOS[id].author} · ${PHOTOS[id].license}`
