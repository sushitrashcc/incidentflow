'use strict';
// Product catalogue for the Cartora storefront. Prices are in Indian Rupees.

const categories = [
  { id: 'electronics', name: 'Electronics', blurb: 'Audio, wearables & accessories' },
  { id: 'fashion', name: 'Fashion', blurb: 'Everyday wear & footwear' },
  { id: 'home', name: 'Home & Kitchen', blurb: 'Cookware, decor & essentials' },
  { id: 'beauty', name: 'Beauty', blurb: 'Skin care & grooming' },
  { id: 'sports', name: 'Sports & Fitness', blurb: 'Train, run & recover' },
  { id: 'books', name: 'Books', blurb: 'Bestsellers & tech reads' }
];

const products = [
  { id: 'p101', category: 'electronics', name: 'Aurion Wireless Earbuds ANC', brand: 'Aurion', price: 2499, mrp: 4999, rating: 4.3, reviews: 12840, stock: 42, color: '#1d2b3a',
    desc: 'Active noise cancellation, 32 hour battery with case, low-latency game mode and IPX5 sweat resistance.' },
  { id: 'p102', category: 'electronics', name: 'Pulse Fit Smartwatch 1.96"', brand: 'Pulse', price: 3299, mrp: 6999, rating: 4.1, reviews: 8421, stock: 18, color: '#3a2f5b',
    desc: 'AMOLED display, Bluetooth calling, SpO2 and heart-rate tracking, 100+ sport modes and 7 day battery.' },
  { id: 'p103', category: 'electronics', name: 'Voltix 20000mAh Power Bank', brand: 'Voltix', price: 1499, mrp: 2999, rating: 4.4, reviews: 22310, stock: 120, color: '#0f3d3e',
    desc: '22.5W fast charging, USB-C power delivery, charges three devices at once. Airline safe.' },
  { id: 'p104', category: 'electronics', name: 'Bassline Portable Speaker 20W', brand: 'Bassline', price: 1899, mrp: 3499, rating: 4.2, reviews: 5310, stock: 7, color: '#5b1f1f',
    desc: 'Deep bass, 12 hour playback, IPX7 waterproof, pair two speakers for stereo sound.' },
  { id: 'p201', category: 'fashion', name: 'Men’s Oxford Cotton Shirt', brand: 'Threadline', price: 799, mrp: 1799, rating: 4.0, reviews: 3104, stock: 64, color: '#c9d6e8',
    desc: '100% cotton, regular fit, button-down collar. Machine washable and wrinkle resistant.' },
  { id: 'p202', category: 'fashion', name: 'Stride Running Shoes', brand: 'Stride', price: 2199, mrp: 3999, rating: 4.3, reviews: 9876, stock: 33, color: '#e9e4da',
    desc: 'Breathable mesh upper, cushioned EVA sole and anti-skid rubber outsole for daily runs.' },
  { id: 'p203', category: 'fashion', name: 'Women’s Block Print Kurta', brand: 'Indigo Loom', price: 999, mrp: 2299, rating: 4.4, reviews: 4512, stock: 51, color: '#d9c3a5',
    desc: 'Hand block printed cotton kurta with three-quarter sleeves and straight hem.' },
  { id: 'p204', category: 'fashion', name: 'Canvas Everyday Backpack 28L', brand: 'Trailmate', price: 1299, mrp: 2499, rating: 4.2, reviews: 2876, stock: 25, color: '#56624b',
    desc: 'Water-resistant canvas, padded 15.6" laptop sleeve and hidden anti-theft pocket.' },
  { id: 'p301', category: 'home', name: 'Tri-ply Stainless Steel Kadhai 24cm', brand: 'Kitchenova', price: 1749, mrp: 3200, rating: 4.5, reviews: 6230, stock: 29, color: '#cfd3d6',
    desc: 'Tri-ply body for even heating, works on gas and induction, with glass lid.' },
  { id: 'p302', category: 'home', name: 'Ceramic Dinner Set (18 pcs)', brand: 'Clayhouse', price: 2399, mrp: 4500, rating: 4.1, reviews: 1890, stock: 12, color: '#efe8df',
    desc: 'Microwave and dishwasher safe stoneware set for six with matte glaze finish.' },
  { id: 'p303', category: 'home', name: 'Cold Brew Coffee Maker 1L', brand: 'Brewcraft', price: 899, mrp: 1499, rating: 4.3, reviews: 2240, stock: 40, color: '#4a3426',
    desc: 'Borosilicate glass jar with fine-mesh filter. Makes smooth cold brew in 12 hours.' },
  { id: 'p304', category: 'home', name: 'Cotton Double Bedsheet Set', brand: 'Softnest', price: 1099, mrp: 2199, rating: 4.2, reviews: 7712, stock: 58, color: '#b9cbbf',
    desc: '210 thread count cotton bedsheet with two pillow covers, fade-resistant colours.' },
  { id: 'p401', category: 'beauty', name: 'Vitamin C Face Serum 30ml', brand: 'Dermalume', price: 549, mrp: 899, rating: 4.2, reviews: 15200, stock: 90, color: '#f2b45a',
    desc: '10% Vitamin C with hyaluronic acid for brighter, even-toned skin. Fragrance free.' },
  { id: 'p402', category: 'beauty', name: 'Beard Trimmer Pro 40 Settings', brand: 'Groomr', price: 1399, mrp: 2595, rating: 4.3, reviews: 11034, stock: 36, color: '#262a30',
    desc: 'Stainless steel blades, 0.5mm precision, 90 minute runtime and USB-C charging.' },
  { id: 'p501', category: 'sports', name: 'Anti-slip Yoga Mat 6mm', brand: 'Flexa', price: 699, mrp: 1499, rating: 4.4, reviews: 8920, stock: 75, color: '#6c8f7d',
    desc: 'High density TPE mat with alignment lines and carry strap. Sweat and odour resistant.' },
  { id: 'p502', category: 'sports', name: 'Adjustable Dumbbells 2 x 5kg', brand: 'Ironcore', price: 1999, mrp: 3499, rating: 4.1, reviews: 2140, stock: 9, color: '#33363b',
    desc: 'Rubber coated plates with chrome handles. Adjust in 1.25kg steps for home workouts.' },
  { id: 'p601', category: 'books', name: 'The DevOps Field Guide', brand: 'Northgate Press', price: 499, mrp: 799, rating: 4.6, reviews: 1320, stock: 44, color: '#22406b',
    desc: 'Practical handbook on CI/CD, containers, infrastructure as code and incident response.' },
  { id: 'p602', category: 'books', name: 'Clean Architecture in Practice', brand: 'Northgate Press', price: 599, mrp: 999, rating: 4.5, reviews: 980, stock: 31, color: '#6b2240',
    desc: 'Design maintainable software with clear boundaries, testable modules and real examples.' }
];

function findProduct(id) {
  return products.find((p) => p.id === id) || null;
}

function listProducts({ category, q } = {}) {
  let list = products;
  if (category) list = list.filter((p) => p.category === category);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((p) => (p.name + ' ' + p.brand + ' ' + p.desc).toLowerCase().includes(needle));
  }
  return list;
}

module.exports = { categories, products, findProduct, listProducts };
