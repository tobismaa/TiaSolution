const stepCards = Array.from(document.querySelectorAll(".scroll-step"));

if (stepCards.length) {
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("in-view");
                    observer.unobserve(entry.target);
                }
            });
        },
        {
            threshold: 0.3,
            rootMargin: "0px 0px -40px 0px"
        }
    );

    stepCards.forEach((card) => observer.observe(card));
}
