# OpenTable GuestCenter API (Unofficial)

Reverse-engineered API documentation for OpenTable's GuestCenter restaurant management platform.

> **Disclaimer:** This is an unofficial, community-driven documentation effort. OpenTable does not provide public API documentation for GuestCenter. Use at your own risk. This project is not affiliated with, endorsed by, or connected to OpenTable in any way.

## Overview

OpenTable GuestCenter is the restaurant-facing management platform used by thousands of restaurants worldwide. While OpenTable offers a [Partner API](https://www.opentable.com/restaurant-solutions/api-partners/become-a-partner/) (gated, requires approval), there is no public API for restaurants to programmatically manage their own operations.

This documentation was created by capturing and analyzing network requests from the GuestCenter web application.

## Authentication

GuestCenter uses **cookie-based session authentication**. The auth cookies are `httpOnly` and cannot be accessed via JavaScript. Authentication flow:

1. `POST restauth.opentable.com/api/v1/internal/device/nonce` - Device auth
2. `GET gcLogin/api/v1/routing/login` - Session login routing
3. Session cookies are set automatically (including `OT-SessionId`, `otuvid` family)

**Important:** API calls must be made from an authenticated browser context or with valid session cookies forwarded. Bearer tokens are not used.

## Base URL

```
https://guestcenter.opentable.com/gateway/proxies/
```

All endpoints below are relative to this base URL unless otherwise noted.

## Core Concepts

- **RID**: Restaurant ID (numeric, e.g., `1264498`)
- **ReservationId**: UUID for each reservation
- **GuestId**: UUID for each guest in the database
- **ModifiedBy**: User ID of the staff member making changes
- **SlotLock**: Temporary hold on a time slot during booking (5 min expiry). Not required for internal bookings.
- **restaurantDay**: Date in `YYYY-MM-DD` format (local timezone)
- **Scheduled**: DateTime in UTC (ISO 8601)
- **ScheduledLocal**: DateTime in restaurant's local timezone

## Endpoints

### Restaurant Info

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `gcrestaurant/api/restaurants/{rid}` | Restaurant details |
| GET | `gcrestaurant/api/userContext` | Current user context |
| GET | `gcrestaurant/api/aggregatedrestaurants/{rid}` | Aggregated restaurant data |
| GET | `gcrestaurant/setup/api/restaurant/{rid}/lockout` | Lockout status |
| GET | `featureManager/v3/api/restaurant/{rid}/toggles` | Feature flags |
| GET | `featureManager/v3/api/globalToggle/{toggleName}` | Global feature toggle |
| GET | `gcnavigation/api/v1/restaurant/{rid}` | Navigation menu config |
| GET | `gcPermissionsAggregator/api/v2/contexts/urn:ot.restaurants:{rid}/principals/urn:ot.rest.users:{uid}/permissions` | User permissions |
| GET | `restaurantAdminService/restaurant-admin/v3/restaurants/{rid}` | Admin restaurant details |
| GET | `aggregator/restaurantProfileFeatures/{rid}` | Restaurant profile features |
| GET | `product-activation/onboardingEventTracking/onboarding-status/v1/{rid}` | Onboarding status |
| GET | `aggregator/reviewsummary/restaurant/{rid}/sevenday/v2?comparativeStartDate=...&comparativeEndDate=...` | 7-day review summary |
| GET | `aggregator/reviewsummary/restaurant/{rid}?includeRatings=false` | Review summary (no ratings) |
| GET | `rgsearch/api/v2/restaurants` | Restaurant search (multi-location) |
| GET | `rgsearch/api/v2/groups?pageSize=5` | Restaurant groups |
| POST | `gateway/api/account/switch/rid` | Switch active restaurant |
| GET | `security/iamuserverification/api/v1/user/verification/urn:ot.restaurants:{rid}/self-service/supported` | User verification |
| GET | `assistive-insights/bff/api/v1/restaurant/{rid}/notifications` | Insight notifications |
| GET | `restaurantpartnerapigateway/salesforceProxyService/salesforce-data/v1/accounts/past-due/{rid}` | Salesforce billing status |

### Reservations

#### List Reservations for a Day

```http
POST gcFohWeb/api/{rid}/bulk-sync?entities=Reservations,CoverBlocks,TableBlocks
```

```json
{
  "Reservations": {
    "restaurantDay": "2026-11-02",
    "sinceSequenceId": 0,
    "useNewReservationSyncApi": true
  },
  "CoverBlocks": {
    "restaurantDay": "2026-11-02",
    "sinceSequenceId": 0,
    "count": 1000
  },
  "TableBlocks": {
    "startDate": "2026-11-02T05:00:00",
    "endDate": "2026-11-03T04:59:00",
    "sinceSequenceId": 0,
    "includeDeleted": true,
    "count": 500
  }
}
```

#### Create Reservation

```http
POST foh-web/gcFohWeb/api/{rid}/v2/reservations?disableVault=true
```

```json
{
  "RID": 1264498,
  "State": "NotConfirmed",
  "Origin": "PHONE",
  "ReservationId": "<uuid>",
  "PartySize": 2,
  "Scheduled": "2026-11-03T03:00:00Z",
  "ScheduledLocal": "2026-11-02T20:00:00",
  "$restaurantDay": "2026-11-02",
  "GuestId": "<guest-uuid>",
  "DiningAreaId": 0,
  "ExperienceId": 0,
  "DiningArea": { "Selection": "any", "Id": 0 },
  "SlotLockId": null,
  "SMSOptIn": false,
  "EmailConfirmationOptOut": false,
  "OverbookingReason": "None",
  "CancellationPolicyId": "<policy-id>",
  "CancellationPolicyWaivedReason": "InHouse",
  "DepositDetails": {
    "TotalPrice": 60000,
    "Currency": "MXN",
    "CurrencyDenominator": 100,
    "Status": "Waived"
  },
  "BookingContext": {
    "NoTablesAvailable": false,
    "NoPrivateDiningAvailable": false,
    "OnlyNonreservableTablesAvailable": false,
    "EachAvailableTableViolatesATurnControl": false,
    "PartySizeViolatesExperienceConstraints": false,
    "NoTablesAvailableForExperience": false,
    "TimeViolatesExperienceConstraints": false,
    "AllowedBookingChannelViolations": [],
    "AllowAccessRuleViolation": false
  },
  "CommandParameters": {
    "ModifiedBy": "<user-id>",
    "ClientInfo": {
      "Client": "Web App",
      "ClientVersion": "gc-microapp-front-of-house-Base-10144"
    }
  },
  "Tags": [],
  "$allTags": []
}
```

**Response:** Full reservation object with `ConfirmationNumber`, assigned `Tables`, `SequenceId`, timestamps.

**Notes:**
- `SlotLockId` can be `null` for internal/phone bookings
- `DepositDetails.Status` can be `"Waived"` or `"PendingDinerPayment"`
- Generate `ReservationId` client-side with `crypto.randomUUID()`
- `Scheduled` is UTC, `ScheduledLocal` is restaurant timezone

#### Universal Reservation Update (PUT)

All reservation modifications use the same endpoint:

```http
PUT foh-web/gcFohWeb/api/{rid}/v2/reservations/{reservationId}
```

Body is always wrapped in `{"reservation": {...}}`. You can update one or more fields per call.

#### Cancel Reservation

```json
{
  "reservation": {
    "State": "Cancelled",
    "Departed": null,
    "CommandParameters": {
      "ModifiedBy": "<user-id>"
    },
    "CustomState": { "CustomStateId": null },
    "ReservationId": "<reservation-uuid>"
  }
}
```

**Important:** State is `"Cancelled"` (British spelling with double L), NOT `"Canceled"`.

#### Change Reservation State

```json
{
  "reservation": {
    "State": "Confirmed",
    "ReservationId": "<reservation-uuid>",
    "CommandParameters": { "ModifiedBy": "<user-id>" }
  }
}
```

#### Move Reservation (Change Time)

```json
{
  "reservation": {
    "Scheduled": "2026-11-03T03:15:00Z",
    "ScheduledLocal": "2026-11-02T20:15:00",
    "ReservationId": "<reservation-uuid>",
    "CommandParameters": { "ModifiedBy": "<user-id>" }
  }
}
```

#### Change Party Size

```json
{
  "reservation": {
    "PartySize": 4,
    "ReservationId": "<reservation-uuid>",
    "CommandParameters": { "ModifiedBy": "<user-id>" }
  }
}
```

#### Add Visit Note

```json
{
  "reservation": {
    "VenueNotes": "Guest prefers corner table"
  }
}
```

#### Assign Referrer/Concierge

```json
{
  "reservation": {
    "Referrer": {
      "Id": 180182759878,
      "FirstName": "John",
      "LastName": "Doe",
      "CompanyName": "Hotel Example",
      "PhoneNumber": {
        "CountryCode": 0,
        "CountryID": "MX",
        "Number": "1234567890",
        "PhoneNumberType": 0
      },
      "Email": null
    },
    "ReservationId": "<reservation-uuid>"
  }
}
```

**Note:** Referrer `Id` is the `GlobalPersonId` from the referrers list endpoint.

#### Available States

| State | API Value | Set via API | Description |
|-------|-----------|-------------|-------------|
| Reservada | `NotConfirmed` | ✅ | Initial state after creation |
| Confirmado | `Confirmed` | ✅ | Guest confirmed |
| Cancelada | `Cancelled` | ✅ | Reservation cancelled (British spelling) |
| Mensaje entregado | `MessageDelivered` | ❌ (400) | Requires real delivery event |
| Número incorrecto | `WrongNumber` | ✅ | Phone number incorrect |
| Sin respuesta | `NoAnswer` | ✅ | No response from guest |

#### Reservation Response Fields (90+ fields)

Key fields returned in every reservation response:

| Field | Type | Description |
|-------|------|-------------|
| `ReservationId` | UUID | Unique reservation identifier |
| `ConfirmationNumber` | int | Human-readable confirmation number |
| `State` | string | Current reservation state |
| `PartySize` | int | Number of guests |
| `Scheduled` | ISO 8601 | UTC datetime |
| `ScheduledLocal` | ISO 8601 | Local timezone datetime |
| `Tables` | array | Assigned tables |
| `GuestId` | UUID | Guest identifier |
| `Guest` | object | Embedded guest data |
| `Referrer` | object | Assigned concierge/referrer |
| `Server` | string | Assigned server name |
| `StaffId` | string | Assigned staff ID |
| `AdditionalStaffIds` | array | Additional staff assigned |
| `VenueNotes` | string | Visit notes |
| `DinerNotes` | string | Guest's own notes |
| `OpenTableNotes` | string | OT system notes |
| `PartnerNotes` | string | Partner integration notes |
| `Arrived` | datetime | When guest arrived |
| `Seated` | datetime | When guest was seated |
| `Departed` | datetime | When guest left |
| `Completed` | datetime | When service completed |
| `NoShow` | datetime | When marked no-show |
| `MinutesLate` | int | How late the guest was |
| `TurnTime` | int | Expected dining duration |
| `DepositDetails` | object | Deposit/payment info |
| `Tags` | array | Reservation tags |
| `Origin` | string | Booking origin (PHONE, ONLINE, etc.) |
| `CustomState` | object | Custom state configuration |
| `PrivateDiningDetails` | object | Private event details |

### Guest Management

#### Search Guests

```http
GET gcFohWeb/api/{rid}/v4/guests/search?query={text}
```

Searches by name or phone number. Returns:

```json
{
  "eligibleForDinerNetworkSearch": false,
  "results": [
    {
      "rid": 1264498,
      "guest_id": "<uuid>",
      "first_name": "John",
      "last_name": "Doe",
      "phone_numbers": [],
      "email": "john@example.com",
      "tags": [],
      "sharing_enabled": true
    }
  ]
}
```

#### Guest Profile (Detailed)

```http
GET crm/guestProfile/api/v1/modular-guest-profile/restaurants/{rid}/guests/{guestId}?modules=contactV2,guest,insights,intelligence,notes,rewards,tags&reservationId={resId}
```

#### Bulk Guest Profiles

```http
POST foh-web/gcFohWeb/api/{rid}/v1/guests/profiles/bulk?modules=contactMini,tags,notes
```

#### Guest Notes (General/Special/Food/Seating)

```http
POST crm/guestProfile/api/v1/modular-guest-profile/restaurants/{rid}/guests/{guestId}?modules=notes
```

Response:

```json
{
  "guestId": "<uuid>",
  "rid": 1264498,
  "notes": [
    {
      "ownerId": 1264498,
      "ownerName": "Restaurant Name",
      "context": "Restaurant",
      "editable": true,
      "value": "Note text here",
      "categories": ["general"]
    }
  ]
}
```

Note categories: `general`, `special`, `foodAndDrink`, `seating`

#### Guest Visit Spend

```http
GET foh-web/gcFohWeb/api/{rid}/reservation/{reservationId}/guest/{guestId}/visit-spend
```

#### Guest Group Profile

```http
GET fohAggregator/restaurant/{rid}/guest/{guestId}/groupProfile?fromRid={rid}
```

#### Guest Tags Config

```http
GET guest-management/autotagsConfigBff/api/v2/restaurant/{rid}/tags
```

### Availability & Schedule

#### Detailed Availability

```http
POST fohAggregator/v4/{rid}/detailedAvailability
```

```json
{
  "date": "2026-11-02",
  "partySize": 2,
  "accessRuleIds": [],
  "bookingChannel": "InHouse"
}
```

#### Schedule (Days)

```http
POST client-aggregator/web/api/restaurants/{rid}/schedule/days
```

#### Closed Days

```http
GET client-aggregator/web/api/restaurants/{rid}/schedule/closed-days?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

#### Availability Plan

```http
GET foh-web/aggregator/v2/restaurant/{rid}/availabilityplan?includeExperiences=true&includePrivateDiningExperiences=false
```

#### Restaurant Configuration

```http
GET client-aggregator/web/api/restaurants/{rid}/configuration
```

### Venue / Tables / Staff

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `gcVenue/umami_venue/api/v4/Restaurant/{rid}` | Venue details (tables, sections, floor plan) |
| GET | `gcVenue/umami_venue/api/v4/Restaurant/{rid}/Policies` | Booking policies |
| GET | `gcVenue/umami_venue/api/v4/Restaurant/{rid}/Staff` | Staff list |
| GET | `gcVenue/umami_venue/api/v4/Restaurant/{rid}/Staff?sinceSequenceId=0&count=1000&includeDeleted=false` | Full staff list with pagination |
| GET | `gcVenue/umami_venue/api/v4/Restaurant/{rid}/Note?startDate=...&endDate=...` | Date notes |
| GET | `gcFohWeb/api/{rid}/restaurantParticipants` | Staff participants for reservation assignment |
| GET | `gcFohWeb/api/{rid}/schedule?startDate=...&endDate=...` | FOH schedule |

### Referrers / Concierges

#### List All Referrers

```http
GET referralManagement/user/v1/restaurants/{rid}/referrers
```

Returns all referrers/concierges configured for the restaurant. Can be hundreds of entries from hotels, agencies, wedding planners, etc.

### Reviews / Feedback

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `hospitality/ot4rFeedbackService/api/v1/entitlements/restaurant/{rid}` | Feedback entitlements |
| POST | `hospitality/ot4rFeedbackBff/api/v1/feedback-reviews/restaurant/{rid}/options` | Review filter options |
| POST | `hospitality/ot4rFeedbackService/api/v1/feedback/restaurant/{rid}/reviews/summary` | Reviews summary (ratings, counts) |
| POST | `hospitality/ot4rFeedbackService/api/v1/feedback/restaurant/{rid}/reviews/details` | Individual review details |
| GET | `hospitality/ot4rFeedbackService/api/v2/feedback/restaurant/{rid}/aggregated-alerts?page=reviews` | Review alerts |

#### Reviews Summary Response

```json
{
  "totalCount": 237,
  "averageOverallRating": 4.87,
  "fiveStarCount": 220,
  "fourStarCount": 9,
  "threeStarCount": 5,
  "twoStarCount": 1,
  "oneStarCount": 2,
  "otFoodRatingAvg": 4.77,
  "otServiceRatingAvg": 4.81,
  "otAmbianceRatingAvg": 4.88,
  "otValueRatingAvg": 4.53
}
```

#### Reviews Details Response

Aggregates reviews from **Google**, **OpenTable**, and **TripAdvisor** in a single endpoint.

```json
{
  "meta": { "totalCount": 27, "limit": 25, "pageNumber": 0, "hasReviews": true },
  "data": [
    {
      "id": "RT-{rid}-{hash}",
      "guestName": "John Doe",
      "source": "Google",
      "overallRating": 5.0,
      "foodRating": 0.0,
      "serviceRating": 0.0,
      "ambianceRating": 0.0,
      "comment": "Amazing food!",
      "reviewDate": "2026-08-15T18:34:10Z",
      "respondable": true,
      "rtRespondable": true,
      "businessResponseUrl": "https://www.google.com/maps/reviews/...",
      "responses": [],
      "privateNotes": "",
      "tags": []
    }
  ]
}
```

**Sources:** `"Google"`, `"OpenTable"`, `"TripAdvisor"`
**`respondable`:** Can reply to this review
**`rtRespondable`:** Can reply via ReviewTrackers (Google/TripAdvisor)
**`businessResponseUrl`:** Direct link to reply on Google Maps

### Reporting / Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `long-proxies/restaurant-reporting/reportingBiDatasources/api/v1/cover-trends-report/range/?rid={rid}&startDate=...&endDate=...&granularity=DAY` | Cover trends |
| GET | `long-proxies/marketing/reportingBiDatasources/api/v3/reservations/summary/?rid={rid}&startDate=...&endDate=...` | Reservations summary |
| GET | `marketing/reportingBiDatasources/api/v1/cover-types-covers/range/?rid={rid}&startDate=...&endDate=...` | Cover types breakdown |
| GET | `pi-marketplace/performanceHomePage/api/v1/performance-homepage/{rid}?startDate=...&endDate=...` | Performance dashboard |

### Booking Policies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `foh-web/restaurantPolicies/v1/{rid}/booking-policy-summaries` | Booking policies |
| GET | `foh-web/aggregator/v1/restaurant/{rid}/cancellation-policies/search?startTime=...&endTime=...&minPartySize=...&maxPartySize=...` | Cancellation policies by time/size |
| GET | `foh-web/restaurantPolicies/v1/{rid}/cancellation-policies/{policyId}/cutoff?reservationDateTime=...&creationDateTime=...` | Cancellation cutoff |

### Inventory / Availability Planning

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `availabilityPlanningBff/api/restaurants/{rid}/errorNotifications` | Availability errors |
| GET | `restops-ap/availabilityPlanningBff/api/restaurants/{rid}/privateDiningPartners` | Private dining partners |
| GET | `restops-ap/availabilityPlanningBff/api/v2/restaurants/{rid}/diningAreas` | Dining areas/sections |

### Messaging

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `gc-inbox/gcDmService/v2/restaurants/{rid}/context` | Messaging context |
| GET | `gc-inbox/gcDmService/v2/restaurants/{rid}/conversation/info?sixMonthFilter=true` | Conversation list |
| GET | `gc-inbox/gcDmService/v2/restaurants/{rid}/conversation/confirmation/{confirmationNumber}` | Confirmation messages |

### Slot Locking (Online Bookings)

```http
POST gcVenue/umami_venue/api/v4/Restaurant/{rid}/SlotLock
```

Used for online/deposit bookings. Not required for internal (`Origin: "PHONE"`) bookings with waived deposit.

### Sync / Real-time

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `gcFohWeb/api/{rid}/initial-sync` | Initial data sync |
| GET | `gcFohWeb/api/{rid}/latest-sequence-ids?entities=SlotLock,Reservation,...` | Sequence tracking for incremental sync |
| POST | `client-sync/web/api/v1/sync/restaurant/{rid}/entities` | Entity sync |
| POST | `restaurantEventStream/stream/v1/restaurant-operations/api/restaurant/{rid}/configuration?sync=1` | Config sync |
| POST | `long-proxies/syncproxy/v1/{sessionId}/sync?showNullValues=true&rid={rid}` | Long-polling sync |

### Users / Accounts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `accounts/gums/api/v1/restaurants/{rid}/users/{uid}?include_related_profiles=true` | User details |
| POST | `accounts/gums/api/v1/users/search` | Search users |

### Private Dining / Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `private-dining/entitlementFeatureService/api/v1/entitlement/restaurant/{rid}` | Private dining features/entitlements |
| GET | `private-dining/restaurantDataService/restaurant-data/v1/restaurants/{rid}/products` | Private dining products |
| GET | `private-dining/gcPermissionsAggregator/api/v2/contexts/urn:ot.restaurants:{rid}/principals/urn:ot.rest.users:{uid}/permissions` | Private dining permissions |

### Referrer Data Structure

Each referrer/concierge object from the referrers list:

```json
{
  "GlobalPersonId": 180182759878,
  "FirstName": "John",
  "LastName": "Doe",
  "CompanyName": "Hotel Example",
  "IsActive": true,
  "PhoneNumbers": [
    {
      "CountryCode": 0,
      "CountryID": "MX",
      "Number": "624 184 0319",
      "PhoneNumberType": 0
    }
  ],
  "Email": "",
  "Rid": 1264498,
  "UserType": 10,
  "UpdatedUTC": "2024-02-27T02:52:28.942Z"
}
```

**Note:** When assigning a referrer to a reservation, use `GlobalPersonId` as the `Id` field.

## GuestCenter Sections

| Section | URL Path | Key Endpoints |
|---------|----------|---------------|
| Home | `/home` | performance-homepage, schedule, notifications |
| Reservations | `/front-of-house/reservations/{date}` | bulk-sync, initial-sync, guest profiles |
| Guestbook | `/front-of-house/gm/guestbook` | guest profiles bulk |
| Reporting | `/reporting/cover-trends` | cover-trends-report, reporting-metadata |
| Marketing | `/marketing/insights` | cover-trends, reservations/summary |
| Reviews | `/feedback/reviews` | feedback reviews summary/details |
| Profile | `/profile/basic-information` | restaurantGroupService |
| Inventory | `/inventory#/shift` | availabilityPlanningBff, diningAreas |
| Accounts | `/accounts/user-directory` | gums users |

## Contributing

If you've discovered additional endpoints or have corrections, please open a PR. Ensure all example data is sanitized (no real restaurant IDs, guest data, or auth tokens).

## License

MIT
