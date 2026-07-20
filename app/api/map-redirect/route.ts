import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const name = req.nextUrl.searchParams.get("name") || "";
  
  if (!url) {
    return NextResponse.redirect(new URL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(name)}`, req.url));
  }

  // If it's already a directions URL, just return it
  if (url.includes("/dir/") || url.includes("directions")) {
    return NextResponse.redirect(url);
  }

  try {
    const res = await fetch(url, { 
        redirect: "follow", 
        headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
        } 
    });
    const finalUrl = res.url;

    if (finalUrl.includes("/dir/") || finalUrl.includes("directions")) {
        return NextResponse.redirect(finalUrl);
    }
    
    let destination = encodeURIComponent(name);
    let exactFound = false;
    
    // Try to extract exact pin coordinates from data parameter (!3d...!4d...)
    const exactPinMatch = finalUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (exactPinMatch) {
        destination = `${exactPinMatch[1]},${exactPinMatch[2]}`;
        exactFound = true;
    } else {
        // Fallback to viewport center coordinates
        const latLngMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (latLngMatch) {
           destination = `${latLngMatch[1]},${latLngMatch[2]}`;
           exactFound = true;
        } else {
           // Fallback to place name in URL
           const placeMatch = finalUrl.match(/\/place\/([^\/]+)\//);
           if (placeMatch) {
              destination = placeMatch[1];
              exactFound = true;
           } else {
               const searchMatch = finalUrl.match(/query=([^&]+)/);
               if (searchMatch) {
                   destination = searchMatch[1];
                   exactFound = true;
               }
           }
        }
    }

    if (exactFound && name) {
        // We can't specify both coordinates and name easily in old URLs without place_id, 
        // but coordinates are safer to prevent wrong routing.
        return NextResponse.redirect(new URL(`https://www.google.com/maps/dir/?api=1&destination=${destination}`, req.url));
    }

    return NextResponse.redirect(new URL(`https://www.google.com/maps/dir/?api=1&destination=${destination}`, req.url));
  } catch (error) {
    return NextResponse.redirect(new URL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(name)}`, req.url));
  }
}
