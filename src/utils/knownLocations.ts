export interface KnownLocation {
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: 'Hospital' | 'Cancer Center' | 'Research Lab' | 'Blood Bank' | 'Clinic' | 'Courier Hub' | 'Pharmacy' | 'Depot';
}

export const KNOWN_MEDICAL_LOCATIONS: KnownLocation[] = [
  // Chennai & Northern Tamil Nadu
  {
    name: 'Rajiv Gandhi Government General Hospital (RGGGH)',
    address: 'EVR Periyar Salai, Park Town, Chennai, Tamil Nadu 600003',
    lat: 13.0818,
    lng: 80.2774,
    category: 'Hospital',
  },
  {
    name: 'Apollo Hospitals Greams Road',
    address: '21 Greams Lane, Thousand Lights, Chennai, Tamil Nadu 600006',
    lat: 13.0604,
    lng: 80.2505,
    category: 'Hospital',
  },
  {
    name: 'Madras Medical College & Hospital',
    address: 'EVR Periyar Salai, Park Town, Chennai, Tamil Nadu 600003',
    lat: 13.0805,
    lng: 80.2785,
    category: 'Research Lab',
  },
  {
    name: 'Tamil Nadu Medical Services Corp (TNMSC Central Warehouse)',
    address: 'Anna Salai, Nandanam, Chennai, Tamil Nadu 600035',
    lat: 13.0284,
    lng: 80.2392,
    category: 'Courier Hub',
  },
  {
    name: 'Cancer Institute (WIA) Adyar',
    address: 'Sardar Patel Rd, Adyar, Chennai, Tamil Nadu 600020',
    lat: 13.0076,
    lng: 80.2443,
    category: 'Cancer Center',
  },
  {
    name: 'Tamil Nadu Blood Transfusion Council & Red Cross',
    address: '50 Monteith Road, Egmore, Chennai, Tamil Nadu 600008',
    lat: 13.0673,
    lng: 80.2589,
    category: 'Blood Bank',
  },
  {
    name: 'Government Kilpauk Medical College Hospital',
    address: '822 Poonamallee High Rd, Kilpauk, Chennai, Tamil Nadu 600010',
    lat: 13.0784,
    lng: 80.2428,
    category: 'Hospital',
  },
  {
    name: 'Government Stanley Medical College Hospital',
    address: 'Old Jail Rd, Royapuram, Chennai, Tamil Nadu 600001',
    lat: 13.1077,
    lng: 80.2872,
    category: 'Hospital',
  },
  {
    name: 'Kauvery Hospital Alwarpet',
    address: 'No. 81 TTK Road, Alwarpet, Chennai, Tamil Nadu 600018',
    lat: 13.0379,
    lng: 80.2536,
    category: 'Hospital',
  },
  {
    name: 'MIOT International Hospital',
    address: '4/112 Mount Poonamallee High Rd, Manapakkam, Chennai, Tamil Nadu 600089',
    lat: 13.0232,
    lng: 80.1772,
    category: 'Hospital',
  },
  {
    name: 'King Institute of Preventive Medicine & Research',
    address: 'Guindy, Chennai, Tamil Nadu 600032',
    lat: 13.0118,
    lng: 80.2134,
    category: 'Research Lab',
  },

  // Vellore
  {
    name: 'Christian Medical College (CMC) Vellore',
    address: 'Ida Scudder Road, Vellore, Tamil Nadu 632004',
    lat: 12.9250,
    lng: 79.1350,
    category: 'Hospital',
  },

  // Coimbatore & Western Tamil Nadu
  {
    name: 'Coimbatore Medical College Hospital (CMCH)',
    address: 'Trichy Rd, Gopalapuram, Coimbatore, Tamil Nadu 641018',
    lat: 11.0016,
    lng: 76.9674,
    category: 'Hospital',
  },
  {
    name: 'PSG Hospitals & Institute of Medical Sciences',
    address: 'Avinashi Rd, Peelamedu, Coimbatore, Tamil Nadu 641004',
    lat: 11.0256,
    lng: 77.0048,
    category: 'Hospital',
  },
  {
    name: 'KMCH (Kovai Medical Center and Hospital)',
    address: '99 Avinashi Rd, Peelamedu, Coimbatore, Tamil Nadu 641014',
    lat: 11.0428,
    lng: 77.0372,
    category: 'Hospital',
  },
  {
    name: 'TNMSC Regional Drug Warehouse - Coimbatore',
    address: 'Race Course Road, Coimbatore, Tamil Nadu 641018',
    lat: 11.0055,
    lng: 76.9742,
    category: 'Courier Hub',
  },

  // Madurai & Southern Tamil Nadu
  {
    name: 'Government Rajaji Hospital (GRH)',
    address: 'Panagal Rd, Alwarpuram, Madurai, Tamil Nadu 625020',
    lat: 9.9272,
    lng: 78.1284,
    category: 'Hospital',
  },
  {
    name: 'Meenakshi Mission Hospital and Research Centre',
    address: 'Lake Area, Melur Rd, Madurai, Tamil Nadu 625107',
    lat: 9.9482,
    lng: 78.1634,
    category: 'Hospital',
  },
  {
    name: 'TNMSC Regional Pharma Hub - Madurai',
    address: 'K.Pudur, Madurai, Tamil Nadu 625007',
    lat: 9.9431,
    lng: 78.1462,
    category: 'Courier Hub',
  },

  // Tiruchirappalli (Trichy) - Central Tamil Nadu
  {
    name: 'Mahatma Gandhi Memorial Government Hospital (MGMGH)',
    address: 'Collector Office Road, Tiruchirappalli, Tamil Nadu 620017',
    lat: 10.8060,
    lng: 78.6912,
    category: 'Hospital',
  },
  {
    name: 'Apollo Speciality Hospital Trichy',
    address: 'Old Thanjavur Rd, Ariyamangalam, Tiruchirappalli, Tamil Nadu 620010',
    lat: 10.8123,
    lng: 78.7180,
    category: 'Hospital',
  },

  // Salem & Tirunelveli
  {
    name: 'Government Mohan Kumaramangalam Medical College Hospital',
    address: 'Fort Main Rd, Shevapet, Salem, Tamil Nadu 636001',
    lat: 11.6583,
    lng: 78.1512,
    category: 'Hospital',
  },
  {
    name: 'Tirunelveli Medical College Hospital (TvMCH)',
    address: 'High Ground, Palayamkottai, Tirunelveli, Tamil Nadu 627011',
    lat: 8.7145,
    lng: 77.7471,
    category: 'Hospital',
  },
];
