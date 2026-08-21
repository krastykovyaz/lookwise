// Local mock data — UI development only, for the Discover preview grid
// and the ProductDetails scaffold. Nothing here should be imported by
// /lib/ebay or /lib/ai; when Milestone 1 lands, this file is deleted
// wholesale and the same Product type is filled from real eBay data.

import type { Product } from "@/types/product";

export const MOCK_PRODUCTS: Product[] = [
  {
    id: "mock-1",
    title: "Nike Dunk Low Retro",
    price: 95,
    currency: "USD",
    image:
      "https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?w=800&q=80",
    condition: "Pre-owned — Good",
    conditionId: "3000",
    brand: "Nike",
    color: "White / Black",
    category: "Sneakers",
    seller: { username: "sneaker_vault", feedbackScore: 2140, feedbackPercentage: 98.8 },
    location: "Portland, OR",
    shipping: {
      cost: 0,
      currency: "USD",
      service: "Standard",
      estimatedDelivery: null,
      shipsTo: "US",
    },
    returnPolicy: "30-day returns",
    availability: null,
    buyingOptions: ["FIXED_PRICE"],
    itemWebUrl: null,
    dealScore: 88,
  },
  {
    id: "mock-2",
    title: "Vintage Leather Bomber Jacket",
    price: 140,
    currency: "USD",
    image:
      "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800&q=80",
    condition: "Pre-owned — Very Good",
    conditionId: "3000",
    brand: "Schott NYC",
    color: "Brown",
    category: "Outerwear",
    seller: { username: "thrift_finds_co", feedbackScore: 861, feedbackPercentage: 99.2 },
    location: "Brooklyn, NY",
    shipping: {
      cost: 12,
      currency: "USD",
      service: "Standard",
      estimatedDelivery: null,
      shipsTo: "US",
    },
    returnPolicy: "No returns",
    availability: null,
    buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
    itemWebUrl: null,
    dealScore: 82,
  },
  {
    id: "mock-3",
    title: "Leica M6 35mm Film Camera",
    price: 2350,
    currency: "USD",
    image:
      "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=800&q=80",
    condition: "Pre-owned — Excellent",
    conditionId: "3000",
    brand: "Leica",
    color: "Black",
    category: "Cameras",
    seller: { username: "classic_optics", feedbackScore: 4310, feedbackPercentage: 99.6 },
    location: "Zurich, Switzerland",
    shipping: {
      cost: 35,
      currency: "USD",
      service: "Express",
      estimatedDelivery: null,
      shipsTo: "Worldwide",
    },
    returnPolicy: "14-day returns",
    availability: null,
    buyingOptions: ["FIXED_PRICE"],
    itemWebUrl: null,
    dealScore: 91,
  },
  {
    id: "mock-4",
    title: "Ray-Ban Aviator Classic, Gold",
    price: 85,
    currency: "USD",
    image:
      "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=800&q=80",
    condition: "Pre-owned — Very Good",
    conditionId: "3000",
    brand: "Ray-Ban",
    color: "Gold",
    category: "Sunglasses",
    seller: { username: "optic_reseller", feedbackScore: 2340, feedbackPercentage: 98 },
    location: "Miami, FL",
    shipping: {
      cost: 8,
      currency: "USD",
      service: "Standard",
      estimatedDelivery: null,
      shipsTo: "US",
    },
    returnPolicy: "30-day returns",
    availability: null,
    buyingOptions: ["FIXED_PRICE"],
    itemWebUrl: null,
    dealScore: 91,
  },
];

export function getMockProductById(id: string): Product | undefined {
  return MOCK_PRODUCTS.find((product) => product.id === id);
}
