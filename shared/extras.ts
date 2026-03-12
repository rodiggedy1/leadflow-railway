/**
 * Shared extras catalogue — used by both the frontend (QuoteForm) and backend (pricing, SMS, AI).
 *
 * Keeping this in /shared means the frontend can render the cards and the server
 * can calculate totals and build AI prompts from the same source of truth.
 */

export interface ExtraItem {
  key: string;
  label: string;
  price: number; // USD, added on top of the base cleaning price
  icon: string;  // CDN URL for the flat-style icon
}

// CDN base for extras icons
const CDN =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr";

export const EXTRAS_LIST: ExtraItem[] = [
  { key: "clean_inside_cabinets",     label: "Clean Inside Cabinets",        price: 30,  icon: `${CDN}/clean_inside_cabinets-KLhmfCKSGA4Gbyi6FWkCRX.webp` },
  { key: "clean_inside_empty_fridge", label: "Clean Inside Empty Fridge",    price: 25,  icon: `${CDN}/clean_inside_empty_fridge-Ys3XMTGYBocj3EkpZ6cdVj.webp` },
  { key: "clean_inside_full_fridge",  label: "Clean Inside Full Fridge",     price: 40,  icon: `${CDN}/clean_inside_full_fridge-iCi966LGee5X8PjvsyxZ4N.webp` },
  { key: "clean_inside_oven",         label: "Clean Inside Oven",            price: 30,  icon: `${CDN}/clean_inside_oven-XHY5FFWCATwZjCp6JA7RyZ.webp` },
  { key: "clean_interior_windows",    label: "Clean Interior Windows",       price: 40,  icon: `${CDN}/clean_interior_windows-cG9rJuQ5B7MwxrkFJ8Xwnz.webp` },
  { key: "clean_finished_basement",   label: "Clean Finished Basement",      price: 60,  icon: `${CDN}/clean_finished_basement-oW6gbFpxKsDSxXgi5dZ6ZZ.webp` },
  { key: "green_cleaning",            label: "Green Cleaning",               price: 20,  icon: `${CDN}/green_cleaning-YPvPUMXKNkVeYxvVpoVhAq.webp` },
  { key: "move_in_move_out",          label: "Move-In / Move-Out",           price: 60,  icon: `${CDN}/move_in_move_out-WWV8Y8LuLg8KMWBZxpQJCK.webp` },
  { key: "two_hours_organizing",      label: "2 Hours of Organizing",        price: 80,  icon: `${CDN}/two_hours_organizing-dnnqXQSPmqVzWDw7WAkpPE.webp` },
  { key: "load_of_laundry",           label: "Load of Laundry",              price: 20,  icon: `${CDN}/load_of_laundry-cGTwTwEHsR9xR2kzWBqhRv.webp` },
  { key: "i_have_pets",               label: "I Have Pets",                  price: 15,  icon: `${CDN}/i_have_pets-nk835EzwxMmEH7o76AHs55.webp` },
  { key: "wipe_walls",                label: "Wipe Walls",                   price: 35,  icon: `${CDN}/wipe_walls-ZioQ2reijbetNDSLjaoHYp.webp` },
  { key: "sweep_garage",              label: "Sweep Garage",                 price: 25,  icon: `${CDN}/sweep_garage-Dk3NGbdtShjz7gcsi6sfkV.webp` },
  { key: "balcony_sweep",             label: "Balcony Sweep",                price: 20,  icon: `${CDN}/balcony_sweep-Fqb5R8HGehxKNCeeaFqkDe.webp` },
  { key: "home_concierge",            label: "Home Concierge",               price: 50,  icon: `${CDN}/home_concierge-LRQFfAbiesivHR22rLPKAU.webp` },
  { key: "same_day_booking",          label: "Same Day Booking",             price: 40,  icon: `${CDN}/same_day_booking-VyZa4o7j5HGdefFtb5LoRn.webp` },
  { key: "clean_inside_microwave",    label: "Clean Inside Microwave",       price: 15,  icon: `${CDN}/clean_inside_microwave-mM8Qjxar8v88XrxYzK7PTj.webp` },
  { key: "shed_pool_house",           label: "Shed / Pool House",            price: 50,  icon: `${CDN}/shed_pool_house-VyZa4o7j5HGdefFtb5LoRn.webp` },
  { key: "wash_dishes",               label: "Wash Dishes",                  price: 20,  icon: `${CDN}/wash_dishes-habrMawdSwjip67VuMdZsb.webp` },
  { key: "pool_deck",                 label: "Pool Deck",                    price: 45,  icon: `${CDN}/pool_deck-8iR5V67jdTcHU8oZPoRkze.webp` },
];

/**
 * Returns the total add-on price for the given list of extra keys.
 */
export function calculateExtrasTotal(extraKeys: string[]): number {
  return extraKeys.reduce((sum, key) => {
    const item = EXTRAS_LIST.find((e) => e.key === key);
    return sum + (item?.price ?? 0);
  }, 0);
}

/**
 * Returns an array of { label, price } for the given extra keys.
 * Unknown keys are silently skipped.
 */
export function resolveExtras(extraKeys: string[]): Array<{ key: string; label: string; price: number }> {
  return extraKeys
    .map((key) => EXTRAS_LIST.find((e) => e.key === key))
    .filter((e): e is ExtraItem => e !== undefined)
    .map(({ key, label, price }) => ({ key, label, price }));
}
