const CONFIG = {
  supabase: {
    url: 'https://hvijvibhpmlqxcdjamaf.supabase.co',
    anonKey: 'sb_publishable_3R0dSM8sNxCsOirnS12elg_JSaUXK7M',
  },
  worker: {
    url: 'https://wardrobe-dan.workers.dev/',
  },
  weather: {
    latitude: 45.4215,
    longitude: -75.6972,
    city: 'Ottawa',
  },
  styleIndex: {
    // Rebuilt nightly by GitHub Action — do not edit manually
    path: './data/style-index.json',
  },
  calendar: {
    weeksBack: 1,
    weeksAhead: 1,
  },
};

export default CONFIG;
