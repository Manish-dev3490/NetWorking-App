// Static UI preview only: fictional people, posts, and counts; no API or session data.
// Image URLs are copied from the supplied Gather reference HTML:
// variant-0: portraits, studio sketch, stoneware; variant-1: canvas and pigments;
// variant-2: quiet workspace. Remote URLs are retained because asset downloads
// are unavailable in this environment. These are preview assets, not product media.

const images = {
  "elena": "https://lh3.googleusercontent.com/aida-public/AB6AXuDKDLwmL1CnYuVB_kREg_bz4Bwm3RpoS8CrCh77aES5TbpZmSx0rkWSDFbWnOv0TkqotO5anUk9XXaiSz5LMgbvUGAx2E3xu8JJpgxDcXL_Xn1SDjVYIi8VuHKGDTDJDefj6fx6cRlVgWdnthD8UDy8yzY-kB2yme2FfEv9EzZyav7IFn2b2BHk6fNBdP7spoFrEZMqSRLn9kz6X1OEooaaCkLf5CzukzF0P-nhHzQ",
  "marcus": "https://lh3.googleusercontent.com/aida-public/AB6AXuCjIYXQY7UfblDznWmM2HYR3SitDjDhrZ20IAJEGWj2S9JTqKqy71lAIsvg0owlCSOcoE1rgSBN0_Ic_dwKAxuyrQ45DKVg_IOVLXl4sIhYpYrFyaPnNok_d5j2XHUFMgPbax17YB2ahvoSP9AT_30ujarpbIu__FKyTCp6QOB96WXGe5-IKPYRNjT4-HRhgu44okuB0qNBUPZN0XQJety720oLZN5B3C1ETqLHIEQ",
  "aria": "https://lh3.googleusercontent.com/aida-public/AB6AXuAm3YlSgpBFUZIbCbkUJ_BkdMy4FAi66div8Zcd8h-YKuF_wF6BxkPabQ3IbuY7RgVYyruBq4t0DqUEFVs3PdnXe3-CclxzmEOqHsaZrF-1jn53Sc4w83_YVaif5HLg7BA5-8YS-eHcdJMZ0QnJMqK5fgUV1ObpSdZbtZxPWzQ4ssK_S9WLKVXSHjUSuPLIpFGBreICalt6QbXa23MFgiFze33ihdM9olJqWlctdZo",
  "julian": "https://lh3.googleusercontent.com/aida-public/AB6AXuD70qtTb1KXt1kU-EMKPy51ApeZfh9kN-LjONfFXpHQBeoVWmmbQGcihYWHAxAcmwyIouCkZjgA64pwliqLX_ct6LdhZP8yNcNdTvPJi0z_Pq26e5bH0WcO2YWkxW8KYmlbIHE_lMGCcM0guYHMX7sXkg1y3MWhTtJS4ChhQ_aWfZ8WNaTER95YN-2agUz_lcphQkOnVcHHuU47LnKaHe_-kXA9a6XSuYR1GmL1lPM",
  "clara": "https://lh3.googleusercontent.com/aida-public/AB6AXuDWfmp0ZlGOR58A7ioAfnEWZqibfXG6dJzVXVscvJifvan1C7X48VbyohmVLD26O6T8tTJIyu3FV4eQLz7NJzUSyNjWI5ALnbMZl22_ci7Svza0ZGQa_RIaZ5QoNt6rGJVyJ1tLbPufPYDHtFuFb_1TaWET-q_4PaQnaZ6_wYvlIayVC1V3ZPRJPE0ziZGhwepcEoOMygR0kZQGWLsM2EG3M52A3oF2Z9Atj2lh3G4",
  "soren": "https://lh3.googleusercontent.com/aida-public/AB6AXuDAML15EzepWqLe6gltxEBU7Yim8IaWJthHVh_diyecwVHlR03DpyeXRZnS4nXtw57K3J42xhHnTqEo1GthNiRzNwKmfhqiADSt1-xQiVplLFGR3TR4OBublG6AsgUwaHYb9fOMaTRVC8aVhZoRUo1102LV0YLzOm8v-bC1fard4nC3N3YIoDwaQlRzcWk75RWnRquIB10lCBZkAhsG-ItGX0cUo6tc5lBv78XYCTM",
  "studioSketch": "https://lh3.googleusercontent.com/aida-public/AB6AXuAsjWr-6cxu7QXaZDsoA7oLTR_VVhyaU4WaQDcbakkHhWLHP11LsH0z2Drod9YXGd9dTSOiYzyVMCENWZuDIE-0LWhXCS3way1ilzYqozfSrPgQYGhOs5vQqf2IoFgFVgNX5_mmgxzYHs33sP9k1q359KvPcftplAZhHax3-PAus00HDd7J6Ymi-1lOwqEXJLI_MusrBrWjSHq2cDLt8hX-1UsDZ8ceJ4fiL14YWfc",
  "canvasDetail": "https://lh3.googleusercontent.com/aida-public/AB6AXuBb2w0zOP8TV1gid3PCguNomNF1zMLBKrzhM6ji0WTscgaZNWd5NAkaaVB_F0BpnthbxiyHqYm8byZP8-agt0YAB7NIydO3__wCAfheNu3HPt9TaxSrapDcRhilskibUgKYCId3ouk5cKkDBSYyhfWX6xavoKJ5zHILfHrjXhEtny5A-5aHy7krd7yLwJcTd-d-cWKMBShclm-hrBmay8OALANaGkxbtjytwuECUZs",
  "studioPigments": "https://lh3.googleusercontent.com/aida-public/AB6AXuDrH9FRbtfmBPPK66hh7kRmh_tt10m1mLf9sTd1GAS4mEGHiE9gCwRizK8Sq8jD0BlxRkb1jQdVksqgjpVpd3b6iseMXQDPswFDJ4QjC988fFEzHfzrIPo8y88DMsGpqq8pYmcZ0zxNq6LOo4xgHlhnpvTSuBxKrxYOxF7CqUqZA1k36bisY1uBOTEfMeaORGvU3kOr4gGtQt-IDsYH_DWGN8UzcX_2A_zV66a4zkU",
  "stoneware": "https://lh3.googleusercontent.com/aida-public/AB6AXuBtFvSIMgtV4W50iRt9LFg9T_i1LpJnrPT-G30ZsJ6Pud6R8vJXTy6p8xIGg7RnykxGk_gN5_vJ_zvh9enjqfSmCZgJxzFdFAaGLf4BfttXFSlzFHIfJLsWV7JhLalflHbmUFxE2ms5xeXD7LOhIPxOJ48YUhyBg2Wxl5XPI9JLfB5FfVt4A0HJ541eevo4tUO7ROHRfLaHeirL5Lr0B2el5bPATCwCkR_8an-Zx0Q",
  "quietWorkspace": "https://lh3.googleusercontent.com/aida-public/AB6AXuAmZgD4mgA2vKxp4J8WTk0-Ln4eRheudWci8DfqQrYJXIS6CmiwXO8Zt9uB32KxTftIrGC43xbysA06gYithuUJiu2tVu6gR6WQFN7WGw1qItX5Lttr0uRflytdi_1-MoRZt_kCG1E8uk5IDclNHzCmDYxk7RAzoGiNqiOTMT1u3-EGC209biW4ZkxTzN1AkUDFGTxp2EggiJdLrl-Hff845D0kSdaOWxruwG99tvA"
};

export const currentUser = {
  name: 'Elena Vance',
  handle: 'elenavance',
  avatar: images.elena,
  stats: { posts: 28, followers: 314, following: 192 },
};

export const posts = [
  {
    id: 'studio-morning',
    author: { name: 'Marcus Chen', handle: 'marcuschen', avatar: images.marcus },
    time: '2 hours ago',
    images: [
      {
        src: images.studioSketch,
        alt: 'Watercolor study of an olive-tree courtyard beside a ceramic coffee cup on a sunlit drafting table.',
      },
      {
        src: images.canvasDetail,
        alt: 'Linen canvas with soft earthy washes on an easel in a bright studio.',
      },
      {
        src: images.studioPigments,
        alt: 'Natural pigments, ceramic dishes, and brushes arranged on a cedar desk.',
      },
    ],
    caption: 'Morning light catching the morning brew and studio sketchbook. Taking it slow today.',
    tags: ['slowliving', 'studiotime', 'morninglight'],
    likes: 42,
    liked: true,
    saved: false,
    commentCount: 8,
    comments: [
      {
        id: 'courtyard-study',
        author: 'clara_f',
        body: 'The perspective on the courtyard study is breathtaking Marcus.',
      },
      {
        id: 'quiet-washes',
        author: 'theolight',
        body: 'Such delicate wash values. Quiet perfection.',
      },
    ],
  },
  {
    id: 'stoneware-study',
    author: { name: 'Aria Thorne', handle: 'ariathorne', avatar: images.aria },
    time: '5 hours ago',
    images: [
      {
        src: images.stoneware,
        alt: 'Three warm-toned stoneware vessels on a weathered wooden shelf beside dried eucalyptus.',
      },
    ],
    caption: 'Hand-thrown stoneware fresh out of bisque firing. Texture turned out softer than anticipated.',
    tags: ['ceramics', 'madebyhand'],
    likes: 19,
    liked: false,
    saved: true,
    commentCount: 3,
    comments: [
      {
        id: 'stoneware-texture',
        author: 'julian_k',
        body: 'That surface catches the light so beautifully.',
      },
    ],
  },
  {
    id: 'afternoon-workspace',
    author: { name: 'Julian K.', handle: 'julian_k', avatar: images.julian },
    time: 'Yesterday',
    images: [
      {
        src: images.quietWorkspace,
        alt: 'A quiet timber desk with a kettle and ceramic mugs, lit through soft linen curtains.',
      },
    ],
    caption: 'A little afternoon light, a clear desk, and enough room to begin again.',
    tags: ['quietspaces', 'everydaymoments'],
    likes: 28,
    liked: false,
    saved: false,
    commentCount: 5,
    comments: [
      {
        id: 'afternoon-light',
        author: 'elenavance',
        body: 'The kind of corner you could spend a whole afternoon in.',
      },
    ],
  },
];

export const suggestions = [
  { id: 'julian', name: 'Julian K.', handle: 'julian_k', avatar: images.julian, bio: 'Architecture, gardens, and everyday details.' },
  { id: 'clara', name: 'Clara Finch', handle: 'clarafinch', avatar: images.clara, bio: 'Notes on slow design and making.' },
  { id: 'soren', name: 'Soren Vester', handle: 'sorenv', avatar: images.soren, bio: 'Wood, warm light, and useful things.' },
];

export const collections = [
  { id: 'morning-notes', name: 'Morning Notes', count: 14, icon: 'note' },
  { id: 'ceramics-craft', name: 'Ceramics & Craft', count: 32, icon: 'palette' },
  { id: 'architecture', name: 'Architecture', count: 9, icon: 'building' },
];

// People in the preview circle; this is not a stories or ephemeral-content rail.
export const circle = [
  { id: 'marcus', name: 'Marcus Chen', handle: 'marcuschen', avatar: images.marcus },
  { id: 'aria', name: 'Aria Thorne', handle: 'ariathorne', avatar: images.aria },
  { id: 'julian', name: 'Julian K.', handle: 'julian_k', avatar: images.julian },
  { id: 'clara', name: 'Clara Finch', handle: 'clarafinch', avatar: images.clara },
  { id: 'soren', name: 'Soren Vester', handle: 'sorenv', avatar: images.soren },
];

