import mysql.connector

conn = mysql.connector.connect(
    host='gateway04.us-east-1.prod.aws.tidbcloud.com',
    port=4000,
    user='QXWpcJKwPBoGqNG.f679bd03aa5d',
    password='lavuI337Gv3r6hjOW1wI',
    database='CAeRhAUjAZoEuxNGm5QbPr',
    ssl_disabled=False
)
cur = conn.cursor()

# Check if already seeded
cur.execute("SELECT COUNT(*) FROM response_templates")
count = cur.fetchone()[0]
if count > 0:
    print(f"Already seeded ({count} rows). Skipping.")
    conn.close()
    exit(0)

templates = [
    ("Card on File", "Payments", "Reserve the appointment",
     "Hi {first_name}! To reserve your cleaning appointment, we simply place a card on file. Nothing is charged until after your cleaning has been completed. We use Stripe for secure payment processing, and your card information is never stored on our system. Once that's taken care of, your reservation is fully secured.", 0),
    ("Booking Confirmation", "Scheduling", "Confirm the appointment",
     "Great news! 🎉 Your cleaning has been confirmed for {date}. We'll send you a reminder before your appointment, and if anything changes we'll reach out right away. If you have any questions before then, just reply to this message.", 1),
    ("Arrival Delay", "Scheduling", "Cleaner is running late",
     "Hi {first_name}! I wanted to give you a quick update. Our team is running about {minutes} minutes behind because the previous home took a little longer than expected. We sincerely appreciate your patience and will get to you as quickly as possible.", 2),
    ("On the Way", "Scheduling", "Cleaner has left",
     "Hi {first_name}! Your cleaning team is on the way and should arrive in approximately {eta}. Looking forward to taking great care of your home today!", 3),
    ("Access Instructions", "Scheduling", "Need entry information",
     "Hi! Before we head out, could you let us know the best way to access the home? Whether it's a door code, lockbox, concierge, or someone meeting us there, we'll make sure everything goes smoothly.", 4),
    ("Cleaning Complete", "Scheduling", "Service finished",
     "Your cleaning is complete! 🎉 Thank you for trusting Maid in Black with your home. If anything isn't exactly how you expected, just let us know within 24 hours and we'll make it right.", 5),
    ("Review Request", "Reviews", "Ask for a review",
     "Thank you again for choosing Maid in Black! If you were happy with today's cleaning, we'd truly appreciate a quick review. It really helps our small business grow and means a lot to our team.", 6),
    ("Refund Apology", "Refunds", "Own the mistake",
     "I'm truly sorry we let you down. We've processed your refund, and I'm also reviewing what happened with our team so we can make sure this doesn't happen again. Thank you for giving us the opportunity to make it right.", 7),
    ("Free Reclean", "Refunds", "Offer a return visit",
     "Thank you for letting us know. We'd love the opportunity to make this right. We'll send a team back at no charge to address the areas that missed the mark. Our goal is for you to be completely happy with the service.", 8),
    ("No Availability", "Scheduling", "Fully booked",
     "Thank you so much for reaching out! Unfortunately we're fully booked for the dates you requested. The earliest availability we currently have is {next_available_date}. If that works for you, I'd be happy to reserve it.", 9),
    ("Move-Out Quote", "Payments", "Explain pricing",
     "For a move-out cleaning of a {bedrooms}-bedroom, {bathrooms}-bathroom home, most customers fall around {price} depending on the condition of the property and any add-ons like inside the oven, refrigerator, or cabinets.", 10),
    ("Follow-up (No Response)", "Follow-up", "Customer went silent",
     "Hi {first_name}! Just checking in to see if you're still looking for a cleaning. If you have any questions or you'd like to get something scheduled, just reply here—I'm happy to help.", 11),
    ("Recurring Cleaning", "Follow-up", "Convert one-time customers",
     "We also offer recurring cleanings, which many of our customers love because it's more convenient and usually less expensive per visit. If you'd like, I can send over pricing for every 2 weeks or every 4 weeks.", 12),
    ("Thank You", "Follow-up", "Simple appreciation",
     "Thank you for choosing Maid in Black! We truly appreciate the opportunity to earn your business. If you ever need anything at all, just reply here—our team is always happy to help.", 13),
]

cur.executemany(
    "INSERT INTO response_templates (title, category, description, message, sortOrder) VALUES (%s, %s, %s, %s, %s)",
    templates
)
conn.commit()
print(f"Seeded {len(templates)} templates.")
conn.close()
