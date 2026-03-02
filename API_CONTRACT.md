# Tripzync Backend API Contract (Frozen V1)

## Envelope
- Success: `{ "success": true, "data": ..., "meta"?: ... }`
- Error: `{ "success": false, "error": { "code": string, "message": string, "details"?: unknown } }`

## Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/social-login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Social Login Request
```json
{
  "provider": "google | apple",
  "idToken": "provider-id-token",
  "email": "optional@email.com",
  "name": "Optional Name"
}
```

## Trips
- `POST /api/generate-trip`
- `GET /api/trips?limit=&offset=`
- `GET /api/trip/:id`
- `PATCH /api/trip/:id`
- `DELETE /api/trip/:id`
- `POST /api/trip/:id/regenerate`
- `GET /api/explore?limit=&q=`

### Generate Trip Request
```json
{
  "destination": "Tokyo",
  "days": 4,
  "budget": "low | moderate | luxury",
  "startCity": "Osaka"
}
```

### Trip Response Shape
```json
{
  "id": "cuid",
  "destination": "Tokyo",
  "startCity": "Osaka",
  "startLatitude": 34.6937,
  "startLongitude": 135.5023,
  "days": 4,
  "budget": "moderate",
  "userId": "cuid",
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "itinerary": [
    {
      "dayNumber": 1,
      "activities": [
        {
          "time": "Morning",
          "title": "...",
          "description": "...",
          "latitude": 35.68,
          "longitude": 139.69,
          "durationMinutes": 120,
          "travelToNextMinutes": 18,
          "travelToNextKm": 4.2,
          "travelMode": "walk | transit | drive"
        }
      ]
    }
  ]
}
```
