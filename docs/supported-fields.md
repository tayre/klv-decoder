# Supported ST 0601 fields

Mappings target ST 0601.8. This table is generated from the implementation, not a conformance certificate. Nested sets, enumerations, flags and other tags not listed remain raw. Existing payload names are retained for compatibility, including the capitalization of tag 42 and the legacy trailing space in tag 58.

| Tag | Payload name | Bytes | Physical range | Unit |
|---|---|---:|---|---|
| 5 | `platform_heading_angle` | 2 | 0…360 | degrees |
| 6 | `platform_pitch_angle` | 2 | -20…20 | degrees |
| 7 | `platform_roll_angle` | 2 | -50…50 | degrees |
| 8 | `platform_true_airspeed` | 1 | 0…255 | m/s |
| 9 | `platform_indicated_airspeed` | 1 | 0…255 | m/s |
| 13 | `sensor_latitude` | 4 | -90…90 | degrees |
| 14 | `sensor_longitude` | 4 | -180…180 | degrees |
| 15 | `sensor_true_altitude` | 2 | -900…19000 | m |
| 16 | `sensor_horizontal_fov` | 2 | 0…180 | degrees |
| 17 | `sensor_vertical_fov` | 2 | 0…180 | degrees |
| 18 | `sensor_relative_azimuth_angle` | 4 | 0…360 | degrees |
| 19 | `sensor_relative_elevation_angle` | 4 | -180…180 | degrees |
| 20 | `sensor_relative_roll_angle` | 4 | 0…360 | degrees |
| 21 | `slant_range` | 4 | 0…5000000 | m |
| 22 | `target_width` | 2 | 0…10000 | m |
| 23 | `frame_center_latitude` | 4 | -90…90 | degrees |
| 24 | `frame_center_longitude` | 4 | -180…180 | degrees |
| 25 | `frame_center_elevation` | 2 | -900…19000 | m |
| 26 | `offset_corner_latitude_point_1` | 2 | -0.075…0.075 | degrees |
| 27 | `offset_corner_longitude_point_1` | 2 | -0.075…0.075 | degrees |
| 28 | `offset_corner_latitude_point_2` | 2 | -0.075…0.075 | degrees |
| 29 | `offset_corner_longitude_point_2` | 2 | -0.075…0.075 | degrees |
| 30 | `offset_corner_latitude_point_3` | 2 | -0.075…0.075 | degrees |
| 31 | `offset_corner_longitude_point_3` | 2 | -0.075…0.075 | degrees |
| 32 | `offset_corner_latitude_point_4` | 2 | -0.075…0.075 | degrees |
| 33 | `offset_corner_longitude_point_4` | 2 | -0.075…0.075 | degrees |
| 35 | `wind_direction` | 2 | 0…360 | degrees |
| 36 | `wind_speed` | 1 | 0…100 | m/s |
| 37 | `static_pressure` | 2 | 0…5000 | mbar |
| 38 | `density_altitude` | 2 | -900…19000 | m |
| 40 | `target_location_latitude` | 4 | -90…90 | degrees |
| 41 | `target_location_longitude` | 4 | -180…180 | degrees |
| 42 | `target_location_Elevation` | 2 | -900…19000 | m |
| 45 | `target_error_estimate_ce90` | 2 | 0…4095 | m |
| 46 | `target_error_estimate_le90` | 2 | 0…4095 | m |
| 49 | `differential_pressure` | 2 | 0…5000 | mbar |
| 50 | `platform_angle_of_attack` | 2 | -20…20 | degrees |
| 51 | `platform_vertical_speed` | 2 | -180…180 | m/s |
| 52 | `platform_sideslip_angle` | 2 | -20…20 | degrees |
| 53 | `airfield_barometric_pressure` | 2 | 0…5000 | mbar |
| 54 | `airfield_elevation` | 2 | -900…19000 | m |
| 55 | `relative_humidity` | 1 | 0…100 | % |
| 56 | `platform_ground_speed` | 1 | 0…255 | m/s |
| 57 | `ground_range` | 4 | 0…5000000 | m |
| 58 | `platform_fuel_remaining ` | 2 | 0…10000 | kg |
| 64 | `platform_magnetic_heading` | 2 | 0…360 | degrees |
| 65 | `uas_lds_version_number` | 1 | 0…255 | integer |
| 67 | `alternate_platform_latitude` | 4 | -90…90 | degrees |
| 68 | `alternate_platform_longitude` | 4 | -180…180 | degrees |
| 69 | `alternate_platform_altitude` | 2 | -900…19000 | m |
| 71 | `alternate_platform_heading` | 2 | 0…360 | degrees |
| 75 | `sensor_ellipsoid_height` | 2 | -900…19000 | m |
| 82 | `corner_latitude_point_1` | 4 | -90…90 | degrees |
| 83 | `corner_longitude_point_1` | 4 | -180…180 | degrees |
| 84 | `corner_latitude_point_2` | 4 | -90…90 | degrees |
| 85 | `corner_longitude_point_2` | 4 | -180…180 | degrees |
| 86 | `corner_latitude_point_3` | 4 | -90…90 | degrees |
| 87 | `corner_longitude_point_3` | 4 | -180…180 | degrees |
| 88 | `corner_latitude_point_4` | 4 | -90…90 | degrees |
| 89 | `corner_longitude_point_4` | 4 | -180…180 | degrees |
| 90 | `platform_pitch_angle_full` | 4 | -90…90 | degrees |
| 91 | `platform_roll_angle_full` | 4 | -90…90 | degrees |
| 92 | `platform_angle_of_attack_full` | 4 | -90…90 | degrees |
| 93 | `platform_sideslip_angle_full` | 4 | -180…180 | degrees |

Tag 1: 16-bit checksum. Tag 2: 64-bit microsecond timestamp. UTF-8 text: tags 3, 4, 10, 11, 12, 59 and 70.

Offsets in tags 26–33 remain offsets in `payload`; absolute corners are separate in `derived.corners`. No prior-packet frame center is reused.

Reference: [MISB ST 0601.8](https://upload.wikimedia.org/wikipedia/commons/1/19/MISB_Standard_0601.pdf).
